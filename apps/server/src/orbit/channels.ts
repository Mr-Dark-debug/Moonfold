// @effect-diagnostics nodeBuiltinImport:off - Runs `gh` and `npm` in the project folder, like the source control drivers.
/**
 * Orbit's Scout and Sentinel read through these, on the server, so their own sessions need no
 * network or shell for it (D-70). Everything returned is public or tool text: it reaches the agent
 * marked as untrusted, capped in size, and never reaches the builder.
 */
import * as NodeChildProcess from "node:child_process";

import type { OrbitChannels } from "@moonfold/contracts";
import * as HostProcess from "@moonfold/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

export interface ChannelPost {
  readonly source: string;
  readonly url: string;
  readonly title: string;
  readonly text: string;
  readonly at: string | null;
}

class ChannelReadError extends Schema.TaggedError<ChannelReadError>()("ChannelReadError", {
  message: Schema.String,
}) {}

const MAX_POSTS_PER_SOURCE = 15;
const MAX_TEXT = 600;

const clean = (text: string) =>
  text
    .replaceAll(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/&lt;/g, "<")
    .replaceAll(/&gt;/g, ">")
    .replaceAll(/&quot;/g, '"')
    .replaceAll(/&#39;|&apos;/g, "'")
    .replaceAll(/&amp;/g, "&")
    .replaceAll(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TEXT);

const tag = (block: string, name: string) =>
  new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block)?.[1] ?? "";

/** Items of an RSS or Atom feed: enough of each to summarize, never markup. */
export function parseFeed(source: string, xml: string): ReadonlyArray<ChannelPost> {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) ?? [];
  return blocks.slice(0, MAX_POSTS_PER_SOURCE).map((block) => {
    const atomLink = /<link[^>]*href="([^"]+)"/i.exec(block)?.[1];
    return {
      source,
      url: clean(atomLink ?? tag(block, "link")),
      title: clean(tag(block, "title")),
      text: clean(tag(block, "description") || tag(block, "content") || tag(block, "summary")),
      at: clean(tag(block, "pubDate") || tag(block, "updated") || tag(block, "published")) || null,
    };
  });
}

const HackerNewsHits = Schema.Struct({
  hits: Schema.Array(
    Schema.Struct({
      objectID: Schema.String,
      title: Schema.optional(Schema.NullOr(Schema.String)),
      story_title: Schema.optional(Schema.NullOr(Schema.String)),
      comment_text: Schema.optional(Schema.NullOr(Schema.String)),
      story_text: Schema.optional(Schema.NullOr(Schema.String)),
      created_at: Schema.optional(Schema.String),
    }),
  ),
});
const decodeHackerNews = Schema.decodeUnknownEffect(Schema.fromJsonString(HackerNewsHits));

const GitHubIssues = Schema.Array(
  Schema.Struct({
    title: Schema.String,
    body: Schema.optional(Schema.NullOr(Schema.String)),
    url: Schema.String,
    updatedAt: Schema.optional(Schema.String),
  }),
);
const decodeGitHubIssues = Schema.decodeUnknownEffect(Schema.fromJsonString(GitHubIssues));

const getText = Effect.fn("Orbit.getText")(function* (url: string) {
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      HttpClientRequest.get(url).pipe(
        HttpClientRequest.setHeader("user-agent", "Moonfold-Orbit/1 (self-hosted)"),
      ),
    )
    .pipe(
      Effect.timeout("15 seconds"),
      Effect.mapError(() => new ChannelReadError({ message: "could not be reached" })),
    );
  if (response.status < 200 || response.status >= 300) {
    return yield* new ChannelReadError({ message: `answered ${response.status}` });
  }
  return yield* response.text.pipe(
    Effect.mapError(() => new ChannelReadError({ message: "could not be read" })),
  );
});

const hackerNews = Effect.fn("Orbit.hackerNews")(function* (query: string) {
  const text = yield* getText(
    `https://hn.algolia.com/api/v1/search_by_date?tags=(story,comment)&hitsPerPage=${MAX_POSTS_PER_SOURCE}&query=${encodeURIComponent(query)}`,
  );
  const { hits } = yield* decodeHackerNews(text).pipe(
    Effect.mapError(() => new ChannelReadError({ message: "returned something unexpected" })),
  );
  return hits.map((hit): ChannelPost => ({
    source: `hacker-news:${query}`,
    url: `https://news.ycombinator.com/item?id=${hit.objectID}`,
    title: clean(hit.title ?? hit.story_title ?? ""),
    text: clean(hit.comment_text ?? hit.story_text ?? ""),
    at: hit.created_at ?? null,
  }));
});

const execText = (command: string, args: ReadonlyArray<string>, cwd: string, timeoutMs: number) =>
  Effect.flatMap(HostProcess.Platform, (platform) =>
    Effect.callback<{ readonly stdout: string; readonly failed: string | null }>((resume) => {
      NodeChildProcess.execFile(
        command,
        [...args],
        {
          cwd,
          timeout: timeoutMs,
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          // npm is a script on Windows, which execFile only starts through the shell.
          shell: platform === "win32",
        },
        (error, stdout, stderr) =>
          resume(
            Effect.succeed({
              stdout,
              failed: error === null ? null : String(stderr || error.message).slice(0, 300),
            }),
          ),
      );
    }),
  );

const githubIssues = Effect.fn("Orbit.githubIssues")(function* (cwd: string) {
  const result = yield* execText(
    "gh",
    [
      "issue",
      "list",
      "--state",
      "open",
      "--limit",
      String(MAX_POSTS_PER_SOURCE),
      "--json",
      "title,body,url,updatedAt",
    ],
    cwd,
    20_000,
  );
  if (result.failed !== null)
    return yield* new ChannelReadError({ message: "gh could not list issues" });
  const issues = yield* decodeGitHubIssues(result.stdout).pipe(
    Effect.mapError(() => new ChannelReadError({ message: "gh returned something unexpected" })),
  );
  return issues.map((issue): ChannelPost => ({
    source: "github",
    url: issue.url,
    title: clean(issue.title),
    text: clean(issue.body ?? ""),
    at: issue.updatedAt ?? null,
  }));
});

/** Reads every configured channel; one that fails is named in `errors` and skipped. */
export const readChannels = Effect.fn("Orbit.readChannels")(function* (input: {
  readonly channels: OrbitChannels;
  readonly cwd: string;
}) {
  const feedName = (url: string) => {
    try {
      return `feed:${new URL(url).host}`;
    } catch {
      return "feed";
    }
  };
  const reads: ReadonlyArray<{
    readonly name: string;
    readonly read: Effect.Effect<
      ReadonlyArray<ChannelPost>,
      ChannelReadError,
      HttpClient.HttpClient
    >;
  }> = [
    ...(input.channels.github ? [{ name: "github", read: githubIssues(input.cwd) }] : []),
    ...input.channels.hackerNews.map((query) => ({
      name: `hacker-news:${query}`,
      read: hackerNews(query),
    })),
    ...input.channels.reddit.map((subreddit) => ({
      name: `reddit:r/${subreddit}`,
      read: getText(`https://www.reddit.com/r/${subreddit}/new/.rss`).pipe(
        Effect.map((xml) => parseFeed(`reddit:r/${subreddit}`, xml)),
      ),
    })),
    ...input.channels.feeds.map((url) => ({
      name: feedName(url),
      read: getText(url).pipe(Effect.map((xml) => parseFeed(feedName(url), xml))),
    })),
  ];
  const results = yield* Effect.forEach(
    reads,
    ({ name, read }) =>
      read.pipe(
        Effect.map((posts) => ({ name, posts, error: null as string | null })),
        Effect.catch((error) =>
          Effect.succeed({ name, posts: [] as ReadonlyArray<ChannelPost>, error: error.message }),
        ),
      ),
    { concurrency: 4 },
  );
  return {
    posts: results.flatMap((result) => result.posts).filter((post) => post.url !== ""),
    errors: results.flatMap((result) =>
      result.error === null ? [] : [`${result.name}: ${result.error}`],
    ),
  };
});

/** Dependency advisories and the host's open security alerts, for the Sentinel. */
export const securityScan = Effect.fn("Orbit.securityScan")(function* (cwd: string) {
  // Audit tools exit non-zero when they find something; their output is the result.
  const output = (result: { readonly stdout: string; readonly failed: string | null }) =>
    result.stdout.trim() !== "" ? result.stdout : (result.failed ?? "");
  const [audit, dependabot, codeScanning] = yield* Effect.all(
    [
      execText("npm", ["audit", "--json", "--omit=dev"], cwd, 120_000),
      execText(
        "gh",
        ["api", "repos/{owner}/{repo}/dependabot/alerts?state=open&per_page=50"],
        cwd,
        30_000,
      ),
      execText(
        "gh",
        ["api", "repos/{owner}/{repo}/code-scanning/alerts?state=open&per_page=50"],
        cwd,
        30_000,
      ),
    ],
    { concurrency: 3 },
  );
  const cap = (text: string) => (text.length > 12_000 ? `${text.slice(0, 12_000)}\n…cut` : text);
  return {
    dependencyAudit: cap(output(audit)),
    dependabotAlerts: cap(output(dependabot)),
    codeScanningAlerts: cap(output(codeScanning)),
  };
});
