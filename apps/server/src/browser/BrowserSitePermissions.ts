/**
 * BrowserSitePermissions - what agents may do on each website through Moonfold's browser tools:
 * open it and upload files to it. A rule allows, asks or blocks; a site without one follows the
 * defaults. An "ask" waits for an answer in any connected client. Local dev servers are allowed.
 *
 * @module browser/BrowserSitePermissions
 */
import {
  type BrowserSiteAnswerInput,
  type BrowserSiteCapability,
  type BrowserSiteDecision,
  type BrowserSiteDecisions,
  BrowserSiteError,
  BrowserSiteHost,
  type BrowserSitePendingRequests,
  type BrowserSitePermissionRequest,
  type BrowserSitePolicy,
  type BrowserSiteRuleInput,
  type ThreadId,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { normalizePreviewUrl } from "@moonfold/shared/preview";

/** Browsing stays as it was before rules existed; handing a site local files is asked about. */
const DEFAULT_SITE_DECISIONS: BrowserSiteDecisions = { browse: "allow", upload: "ask" };

/** How long an agent waits for the user's answer before giving up. */
const ASK_TIMEOUT = Duration.minutes(5);

const DEFAULTS_ROW = "*";

/** Why an agent may not use a site; the message is written for the agent. */
export class BrowserSiteDenied extends Schema.TaggedError<BrowserSiteDenied>()(
  "BrowserSiteDenied",
  { message: Schema.String },
) {}

const isSiteHost = Schema.is(BrowserSiteHost);
const isDecision = (value: string): value is BrowserSiteDecision =>
  value === "allow" || value === "ask" || value === "block";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

/** Pages that are not on the web: a blank tab, an error page, inline or local content. */
const NON_WEB_SCHEME =
  /^(about|blob|chrome|chrome-error|data|devtools|file|javascript|view-source):/i;

export type SiteOfUrl =
  | { readonly kind: "site"; readonly site: string }
  /** Not on the web, or this machine's own servers: rules do not apply. */
  | { readonly kind: "exempt" }
  /** Not an address a browser would open: refused rather than guessed at. */
  | { readonly kind: "invalid" };

/**
 * The site an address belongs to, read the way the browser will read it: an address without a
 * scheme gets one, so `example.com` and `example.com:443` are both the site `example.com`.
 */
export function siteOfUrl(url: string): SiteOfUrl {
  const trimmed = url.trim();
  if (NON_WEB_SCHEME.test(trimmed)) return { kind: "exempt" };
  let normalized: string;
  try {
    normalized = normalizePreviewUrl(trimmed);
  } catch {
    return { kind: "invalid" };
  }
  const host = new URL(normalized).hostname.toLowerCase().replace(/\.$/, "");
  if (host.length === 0) return { kind: "invalid" };
  if (LOOPBACK_HOSTS.has(host) || host.endsWith(".localhost")) return { kind: "exempt" };
  return { kind: "site", site: host };
}

/** The rule for a host: its own, or the closest parent domain's. */
export function ruleFor<R extends { readonly site: string }>(
  rules: ReadonlyArray<R>,
  host: string,
): R | undefined {
  let best: R | undefined;
  for (const rule of rules) {
    if (host !== rule.site && !host.endsWith(`.${rule.site}`)) continue;
    if (best === undefined || rule.site.length > best.site.length) best = rule;
  }
  return best;
}

const VERBS: Record<BrowserSiteCapability, string> = {
  browse: "opening",
  upload: "uploading files to",
};

export class BrowserSitePermissions extends Context.Service<
  BrowserSitePermissions,
  {
    readonly policy: Effect.Effect<BrowserSitePolicy, BrowserSiteError>;
    readonly setRule: (
      input: BrowserSiteRuleInput,
    ) => Effect.Effect<BrowserSitePolicy, BrowserSiteError>;
    readonly removeRule: (site: string) => Effect.Effect<BrowserSitePolicy, BrowserSiteError>;
    readonly setDefaults: (
      decisions: BrowserSiteDecisions,
    ) => Effect.Effect<BrowserSitePolicy, BrowserSiteError>;
    readonly pending: Stream.Stream<BrowserSitePendingRequests>;
    readonly answer: (input: BrowserSiteAnswerInput) => Effect.Effect<void, BrowserSiteError>;
    /**
     * Lets an agent's browser action through, or fails with why not. When the rule says ask, it
     * waits for the user's answer.
     */
    readonly check: (input: {
      readonly threadId: ThreadId;
      readonly url: string;
      readonly capability: BrowserSiteCapability;
    }) => Effect.Effect<void, BrowserSiteDenied>;
  }
>()("moonfold/browser/BrowserSitePermissions") {}

interface RuleRow {
  readonly site: string;
  readonly browse: string;
  readonly upload: string;
  readonly updated_at: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const pendingRef = yield* SubscriptionRef.make<ReadonlyArray<BrowserSitePermissionRequest>>([]);
  const waiting = new Map<string, Deferred.Deferred<BrowserSiteAnswerInput["answer"]>>();
  // "Allow in this chat" answers, keyed by thread, capability and site.
  const threadAllows = yield* Ref.make<ReadonlySet<string>>(new Set());

  const siteError = (message: string) => (cause: unknown) =>
    new BrowserSiteError({ message, cause });

  const readPolicy: Effect.Effect<BrowserSitePolicy, BrowserSiteError> = sql<RuleRow>`
    SELECT * FROM browser_site_rules ORDER BY site ASC
  `.pipe(
    Effect.map((rows): BrowserSitePolicy => {
      const defaultsRow = rows.find((row) => row.site === DEFAULTS_ROW);
      const decision = (value: string | undefined, fallback: BrowserSiteDecision) =>
        value !== undefined && isDecision(value) ? value : fallback;
      return {
        defaults: {
          browse: decision(defaultsRow?.browse, DEFAULT_SITE_DECISIONS.browse),
          upload: decision(defaultsRow?.upload, DEFAULT_SITE_DECISIONS.upload),
        },
        rules: rows.flatMap((row) =>
          row.site !== DEFAULTS_ROW && isSiteHost(row.site)
            ? [
                {
                  site: row.site,
                  browse: decision(row.browse, "ask"),
                  upload: decision(row.upload, "ask"),
                  updatedAt: row.updated_at,
                },
              ]
            : [],
        ),
      };
    }),
    Effect.mapError(siteError("Could not read the site rules.")),
  );

  const writeRow = Effect.fn("BrowserSitePermissions.writeRow")(
    function* (site: string, decisions: BrowserSiteDecisions) {
      yield* sql`
        INSERT INTO browser_site_rules (site, browse, upload, updated_at)
        VALUES (${site}, ${decisions.browse}, ${decisions.upload}, ${yield* now})
        ON CONFLICT (site) DO UPDATE SET
          browse = excluded.browse, upload = excluded.upload, updated_at = excluded.updated_at
      `;
      return yield* readPolicy;
    },
    Effect.catchTags({
      SqlError: (cause) =>
        Effect.fail(new BrowserSiteError({ message: "Could not save the site rule.", cause })),
    }),
  );

  const setRule: BrowserSitePermissions["Service"]["setRule"] = (input) =>
    writeRow(input.site, { browse: input.browse, upload: input.upload });

  const removeRule: BrowserSitePermissions["Service"]["removeRule"] = (site) =>
    sql`DELETE FROM browser_site_rules WHERE site = ${site} AND site <> ${DEFAULTS_ROW}`.pipe(
      Effect.mapError(siteError("Could not remove the site rule.")),
      Effect.andThen(readPolicy),
    );

  const setDefaults: BrowserSitePermissions["Service"]["setDefaults"] = (decisions) =>
    writeRow(DEFAULTS_ROW, decisions);

  const removePending = (id: string) =>
    SubscriptionRef.update(pendingRef, (requests) =>
      requests.filter((request) => request.id !== id),
    ).pipe(Effect.andThen(Effect.sync(() => waiting.delete(id))));

  const answer: BrowserSitePermissions["Service"]["answer"] = Effect.fn(
    "BrowserSitePermissions.answer",
  )(function* (input) {
    const deferred = waiting.get(input.id);
    if (deferred === undefined) {
      return yield* new BrowserSiteError({
        message: "This request is no longer waiting for an answer.",
      });
    }
    yield* Deferred.succeed(deferred, input.answer);
  });

  /** Keeps a site's rule for the other capability while changing this one. */
  const rememberDecision = Effect.fn("BrowserSitePermissions.rememberDecision")(
    function* (site: string, capability: BrowserSiteCapability, decision: BrowserSiteDecision) {
      const policy = yield* readPolicy;
      const current = policy.rules.find((rule) => rule.site === site) ?? policy.defaults;
      yield* writeRow(site, {
        browse: current.browse,
        upload: current.upload,
        [capability]: decision,
      });
    },
    Effect.catch((error) =>
      Effect.logWarning("Could not remember a site permission answer", { error }),
    ),
  );

  const ask = Effect.fn("BrowserSitePermissions.ask")(function* (input: {
    readonly threadId: ThreadId;
    readonly url: string;
    readonly site: string;
    readonly capability: BrowserSiteCapability;
  }) {
    const id = yield* random.uuidV4();
    const deferred = yield* Deferred.make<BrowserSiteAnswerInput["answer"]>();
    const createdAt = yield* now;
    waiting.set(id, deferred);
    yield* SubscriptionRef.update(pendingRef, (requests) => [
      ...requests,
      {
        id,
        threadId: input.threadId,
        site: input.site,
        capability: input.capability,
        url: input.url,
        createdAt,
      },
    ]);
    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOption(ASK_TIMEOUT),
      // Answered, timed out or abandoned: the request stops waiting either way.
      Effect.ensuring(removePending(id)),
    );
  });

  const check: BrowserSitePermissions["Service"]["check"] = Effect.fn(
    "BrowserSitePermissions.check",
  )(function* (input) {
    const target = siteOfUrl(input.url);
    if (target.kind === "exempt") return;
    if (target.kind === "invalid") {
      return yield* new BrowserSiteDenied({
        message: `Moonfold cannot tell which site "${input.url.slice(0, 200)}" is, so it was not opened. Use a full https:// address.`,
      });
    }
    const site = target.site;
    // Hosts a rule cannot name (IP literals, underscores) follow the defaults, and an "always"
    // answer for them applies once.
    const ruleable = isSiteHost(site);
    const policy = yield* readPolicy.pipe(
      // A rule store that cannot be read must not open every site: treat it as asking.
      Effect.orElseSucceed((): BrowserSitePolicy => ({
        defaults: { browse: "ask", upload: "ask" },
        rules: [],
      })),
    );
    const decision = (ruleFor(policy.rules, site) ?? policy.defaults)[input.capability];
    const verb = VERBS[input.capability];
    if (decision === "allow") return;
    if (decision === "block") {
      return yield* new BrowserSiteDenied({
        message: `The user blocks agents from ${verb} ${site}. Do not retry; they can change this in Settings → Integrations → Browser.`,
      });
    }
    const key = `${input.threadId}|${input.capability}|${site}`;
    if ((yield* Ref.get(threadAllows)).has(key)) return;
    const answered = yield* ask({ ...input, site });
    if (Option.isNone(answered)) {
      return yield* new BrowserSiteDenied({
        message: `The user did not answer whether you may continue ${verb} ${site}. Ask them in chat before trying again.`,
      });
    }
    switch (answered.value) {
      case "allow_once":
        return;
      case "allow_thread":
        yield* Ref.update(threadAllows, (current) => new Set([...current, key]));
        return;
      case "always_allow":
        if (ruleable) yield* rememberDecision(site, input.capability, "allow");
        return;
      case "always_block":
        if (ruleable) yield* rememberDecision(site, input.capability, "block");
        return yield* new BrowserSiteDenied({
          message: `The user blocked agents from ${verb} ${site}. Do not retry.`,
        });
      case "deny":
        return yield* new BrowserSiteDenied({
          message: `The user declined ${verb} ${site} this time.`,
        });
    }
  });

  return BrowserSitePermissions.of({
    policy: readPolicy,
    setRule,
    removeRule,
    setDefaults,
    pending: SubscriptionRef.changes(pendingRef).pipe(Stream.map((requests) => ({ requests }))),
    answer,
    check,
  });
});

export const layer = Layer.effect(BrowserSitePermissions, make);
