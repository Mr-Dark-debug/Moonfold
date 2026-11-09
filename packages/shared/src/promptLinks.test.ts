import { EnvironmentId, ThreadId } from "@moonfold/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildNewThreadLink,
  parseNewThreadLink,
  parseThreadLinkPrompt,
  promptLinkAppPath,
  promptLinkDeepLink,
  sanitizeLinkedPrompt,
  withoutPromptLinkParams,
} from "./promptLinks.ts";
import { hostedThreadLink } from "./threadLinks.ts";

describe("sanitizeLinkedPrompt", () => {
  it("removes characters a reader cannot see and counts them", () => {
    const tagged = "rate me" + String.fromCodePoint(0xe0041, 0xe0042);
    expect(sanitizeLinkedPrompt(`a\u200Bb\u202Ec\uFEFF${tagged}`)).toEqual({
      text: "abcrate me",
      hiddenCharacters: 5,
    });
    expect(sanitizeLinkedPrompt("a\u2028b\u2029c")).toEqual({
      text: "a\nb\nc",
      hiddenCharacters: 0,
    });
  });

  it("keeps emoji sequences intact", () => {
    const family = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}";
    const heart = "\u2764\uFE0F";
    expect(sanitizeLinkedPrompt(`${family} ${heart}`)).toEqual({
      text: `${family} ${heart}`,
      hiddenCharacters: 0,
    });
    expect(sanitizeLinkedPrompt("a\u200Db").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{1F468}\u200D").hiddenCharacters).toBe(1);
    expect(sanitizeLinkedPrompt("\u{20000}\u200D\u{20001}").hiddenCharacters).toBe(1);
  });
});

describe("parseNewThreadLink", () => {
  it("reads a shared prompt with its optional repository and model", () => {
    const result = parseNewThreadLink(
      "?prompt=Rate+me&repo=https://github.com/moonfold-dev/moonfold.git&provider=Codex&model=gpt-5",
    );
    expect(result).toEqual({
      ok: true,
      value: {
        kind: "new",
        prompt: { text: "Rate me", hiddenCharacters: 0 },
        repository: { owner: "moonfold-dev", name: "moonfold" },
        provider: "codex",
        model: "gpt-5",
      },
    });
  });

  it("reads a pull request link, whose prompt is optional", () => {
    for (const pr of [
      "moonfold-dev/moonfold/42",
      "moonfold-dev/moonfold%2342",
      "https://github.com/moonfold-dev/moonfold/pull/42/files",
    ]) {
      expect(parseNewThreadLink(`?pr=${pr}`)).toEqual({
        ok: true,
        value: {
          kind: "pull-request",
          pullRequest: { owner: "moonfold-dev", name: "moonfold", number: 42 },
          prompt: null,
        },
      });
    }
  });

  it("refuses links it cannot open safely", () => {
    expect(parseNewThreadLink("?repo=a/b").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseThreadLinkPrompt("?prompt=%E2%80%8B").ok).toBe(false);
    expect(parseNewThreadLink("?prompt=x&repo=../etc").ok).toBe(false);
    expect(parseNewThreadLink(`?prompt=${"x".repeat(8_001)}`).ok).toBe(false);
  });
});

describe("thread links", () => {
  it("reads the prompt and leaves other parameters in place", () => {
    expect(parseThreadLinkPrompt("?prompt=Fix+it")).toEqual({
      ok: true,
      value: { text: "Fix it", hiddenCharacters: 0 },
    });
    expect(parseThreadLinkPrompt("?panel=diff")).toEqual({ ok: true, value: null });
    expect(withoutPromptLinkParams("?prompt=x&panel=diff")).toBe("?panel=diff");
  });
});

describe("link round trips", () => {
  it("builds a link that parses back to the same prompt", () => {
    const link = buildNewThreadLink({
      prompt: "Swear count & rating?",
      repository: { owner: "moonfold-dev", name: "moonfold" },
      provider: "claudeAgent",
      model: "opus",
    });
    // Without a hosted app the link is a desktop deep link.
    expect(link.startsWith("moonfold://new?")).toBe(true);
    const path = promptLinkAppPath(link);
    expect(path).toBe(`/new${new URL(link).search}`);
    const parsed = parseNewThreadLink(new URL(link).search);
    expect(parsed.ok && parsed.value.kind === "new" && parsed.value.prompt.text).toBe(
      "Swear count & rating?",
    );
  });

  it("builds an https link on the hosted app when the build has one", () => {
    const link = buildNewThreadLink({ prompt: "hi", origin: "https://app.example.org" });
    expect(link).toBe("https://app.example.org/new?prompt=hi");
    expect(promptLinkAppPath(link, "https://app.example.org")).toBe("/new?prompt=hi");
    expect(promptLinkAppPath(link)).toBeNull();
  });

  it("opens a copied thread link in the app at that thread", () => {
    const hosted = "https://app.example.org";
    const link = hostedThreadLink(
      { environmentId: EnvironmentId.make("env-1"), threadId: ThreadId.make("mcp:1") },
      hosted,
    );
    const path = promptLinkAppPath(link, hosted);
    expect(path).toBe("/env-1/mcp%3A1");
    const deepLink = promptLinkDeepLink(path!);
    expect(deepLink).toBe("moonfold://threads/env-1/mcp%3A1");
    expect(promptLinkAppPath(deepLink)).toBe(path);
  });

  it("maps app scheme and hosted links to in-app paths, and nothing else", () => {
    expect(promptLinkAppPath("moonfold://new?prompt=hi")).toBe("/new?prompt=hi");
    expect(promptLinkAppPath("moonfold-dev://threads/env-1/thread-1")).toBe("/env-1/thread-1");
    const hosted = "https://app.example.org";
    expect(promptLinkAppPath("https://app.example.org/env-1/thread-1?prompt=go", hosted)).toBe(
      "/env-1/thread-1?prompt=go",
    );
    expect(promptLinkAppPath("https://app.example.org/env-1/thread-1?prompt=go")).toBeNull();
    expect(promptLinkAppPath("https://app.example.org/threads/env-1/thread-1", hosted)).toBe(
      "/env-1/thread-1",
    );
    expect(
      promptLinkAppPath("https://app.example.org/threads/env-1/thread-1?prompt=go", hosted),
    ).toBe("/env-1/thread-1?prompt=go");
    // The web app's own thread route, reloaded, is no link.
    expect(promptLinkAppPath("https://app.example.org/env-1/thread-1", hosted)).toBeNull();
    expect(promptLinkAppPath("https://app.example.org/threads/env-1", hosted)).toBeNull();
    expect(promptLinkAppPath("https://app.example.org/settings/general", hosted)).toBeNull();
    expect(promptLinkAppPath("https://evil.test/new?prompt=hi")).toBeNull();
    expect(promptLinkAppPath("moonfold://app/index.html")).toBeNull();
  });
});
