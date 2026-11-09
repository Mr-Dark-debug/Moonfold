/**
 * ComputerUseService - what agents may do with desktop apps, and the record of what they did.
 * Off until the user turns it on; each app needs approval for the thread (or always). Moonfold's
 * own windows and Windows security screens are never reachable. Every read and action is logged.
 *
 * @module computerUse/ComputerUseService
 */
import {
  type ComputerUseActionKind,
  type ComputerUseActivity,
  type ComputerUseAnswerInput,
  ComputerUseAppName,
  ComputerUseError,
  type ComputerUseLogEntry,
  type ComputerUsePendingRequests,
  type ComputerUsePermissionRequest,
  type ComputerUseState,
  ThreadId,
} from "@moonfold/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import * as ComputerUseHelper from "./ComputerUseHelper.ts";

/** Why an agent may not do something; the message is written for the agent. */
export class ComputerUseRefused extends Schema.TaggedError<ComputerUseRefused>()(
  "ComputerUseRefused",
  { message: Schema.String },
) {}

/** How long an agent waits for the user to approve an app. */
const ASK_TIMEOUT = Duration.minutes(5);
/** How long after its last action a thread still shows as using an app. */
const ACTIVE_WINDOW_MS = 30_000;
const MAX_LOG_ROWS = 1000;
const LOG_PAGE = 200;

/**
 * Apps agents never get, whatever the user approves: Moonfold itself (an agent must not answer
 * its own approval prompts), the screens Windows uses for credentials and consent, the shell and
 * system tools (approving them would hand over the whole machine: the Run dialog, the address
 * bar, Settings, and Store apps, which all share one host process), and password managers.
 */
const BLOCKED_APPS = new Set([
  "consent.exe",
  "credentialuibroker.exe",
  "lockapp.exe",
  "logonui.exe",
  "explorer.exe",
  "applicationframehost.exe",
  "systemsettings.exe",
  "sechealthui.exe",
  "taskmgr.exe",
  "regedit.exe",
  "mmc.exe",
  "1password.exe",
  "bitwarden.exe",
  "dashlane.exe",
  "enpass.exe",
  "keepass.exe",
  "keepassxc.exe",
  "lastpass.exe",
  "roboform.exe",
]);
export function isBlockedWindow(app: string, title: string): boolean {
  return (
    BLOCKED_APPS.has(app) ||
    app.startsWith("moonfold") ||
    /\bmoonfold\b/i.test(title) ||
    // Developer tools of an Electron app can run code inside Moonfold itself.
    /^DevTools\b/.test(title)
  );
}

const HelperWindow = Schema.Struct({
  window: Schema.String,
  title: Schema.String,
  app: Schema.String,
  pid: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
  minimized: Schema.Boolean,
});
export type HelperWindow = typeof HelperWindow.Type;
const decodeWindows = Schema.decodeUnknownEffect(
  Schema.Struct({ windows: Schema.Array(HelperWindow) }),
);
const isAppName = Schema.is(ComputerUseAppName);

export interface ComputerUseWindowTarget {
  readonly threadId: ThreadId;
  readonly window: string;
}

export class ComputerUseService extends Context.Service<
  ComputerUseService,
  {
    readonly state: Effect.Effect<ComputerUseState, ComputerUseError>;
    readonly setEnabled: (enabled: boolean) => Effect.Effect<ComputerUseState, ComputerUseError>;
    readonly removeApp: (app: string) => Effect.Effect<ComputerUseState, ComputerUseError>;
    readonly clearLog: Effect.Effect<ComputerUseState, ComputerUseError>;
    readonly pending: Stream.Stream<ComputerUsePendingRequests>;
    readonly answer: (input: ComputerUseAnswerInput) => Effect.Effect<void, ComputerUseError>;
    readonly activity: Stream.Stream<ComputerUseActivity>;
    /** Turns computer use off, ends the helper and refuses every waiting request. */
    readonly stop: Effect.Effect<void>;
    readonly listApps: (
      threadId: ThreadId,
    ) => Effect.Effect<
      ReadonlyArray<HelperWindow & { readonly approved: boolean }>,
      ComputerUseRefused
    >;
    /**
     * Runs one helper request against an approved app's window and logs it. `detail` is what the
     * log keeps; it must never contain typed text.
     */
    readonly act: (
      target: ComputerUseWindowTarget,
      action: Exclude<ComputerUseActionKind, "list_apps">,
      detail: string,
      args: Readonly<Record<string, unknown>>,
    ) => Effect.Effect<unknown, ComputerUseRefused>;
  }
>()("moonfold/computerUse/ComputerUseService") {}

interface LogRow {
  readonly id: number;
  readonly thread_id: string;
  readonly app: string | null;
  readonly action: string;
  readonly detail: string;
  readonly outcome: string;
  readonly error: string | null;
  readonly at: string;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const random = yield* SecureRandom.SecureRandom;
  const helper = yield* ComputerUseHelper.ComputerUseHelper;
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const pendingRef = yield* SubscriptionRef.make<ReadonlyArray<ComputerUsePermissionRequest>>([]);
  const waiting = new Map<string, Deferred.Deferred<ComputerUseAnswerInput["answer"]>>();
  // "Allow in this chat" answers, keyed by thread and app.
  const threadAllows = yield* Ref.make<ReadonlySet<string>>(new Set());
  const activityRef = yield* SubscriptionRef.make<
    ReadonlyArray<{ readonly threadId: ThreadId; readonly app: string; readonly atMillis: number }>
  >([]);

  const failure = (message: string) => (cause: unknown) => new ComputerUseError({ message, cause });

  const readEnabled = sql<{ readonly value: string }>`
    SELECT value FROM computer_use_settings WHERE key = 'enabled'
  `.pipe(Effect.map((rows) => rows[0]?.value === "true"));

  const readAllowedApps = sql<{ readonly app: string; readonly added_at: string }>`
    SELECT app, added_at FROM computer_use_apps ORDER BY app ASC
  `;

  const state: ComputerUseService["Service"]["state"] = Effect.gen(function* () {
    const enabled = yield* readEnabled;
    const apps = yield* readAllowedApps;
    const log = yield* sql<LogRow>`
      SELECT * FROM computer_use_log ORDER BY id DESC LIMIT ${LOG_PAGE}
    `;
    return {
      supported: helper.supported,
      enabled,
      allowedApps: apps.flatMap((row) =>
        isAppName(row.app) ? [{ app: row.app, addedAt: row.added_at }] : [],
      ),
      log: log.map((row): ComputerUseLogEntry => ({
        id: row.id,
        threadId: ThreadId.make(row.thread_id),
        app: row.app,
        action: row.action as ComputerUseActionKind,
        detail: row.detail,
        outcome: row.outcome === "done" || row.outcome === "refused" ? row.outcome : "failed",
        error: row.error,
        at: row.at,
      })),
    };
  }).pipe(Effect.mapError(failure("Could not read computer-use settings.")));

  // Read when it runs: the waiting requests are the ones open at that moment.
  const refuseWaiting = Effect.suspend(() =>
    Effect.forEach([...waiting.values()], (deferred) => Deferred.succeed(deferred, "deny")),
  );

  const setEnabled: ComputerUseService["Service"]["setEnabled"] = Effect.fn(
    "ComputerUseService.setEnabled",
  )(
    function* (enabled) {
      yield* sql`
        INSERT INTO computer_use_settings (key, value) VALUES ('enabled', ${enabled ? "true" : "false"})
        ON CONFLICT (key) DO UPDATE SET value = excluded.value
      `;
      if (enabled) {
        yield* helper.resume;
      } else {
        yield* refuseWaiting;
        yield* helper.stop;
        yield* Ref.set(threadAllows, new Set());
        yield* SubscriptionRef.set(activityRef, []);
      }
      return yield* state;
    },
    Effect.catchTags({
      SqlError: (cause) =>
        Effect.fail(new ComputerUseError({ message: "Could not change computer use.", cause })),
    }),
  );

  const removeApp: ComputerUseService["Service"]["removeApp"] = (app) =>
    sql`DELETE FROM computer_use_apps WHERE app = ${app}`.pipe(
      Effect.mapError(failure("Could not remove the app.")),
      Effect.andThen(state),
    );

  const clearLog: ComputerUseService["Service"]["clearLog"] =
    sql`DELETE FROM computer_use_log`.pipe(
      Effect.mapError(failure("Could not clear the log.")),
      Effect.andThen(state),
    );

  const log = Effect.fn("ComputerUseService.log")(
    function* (entry: {
      readonly threadId: ThreadId;
      readonly app: string | null;
      readonly action: ComputerUseActionKind;
      readonly detail: string;
      readonly outcome: "done" | "refused" | "failed";
      readonly error?: string;
    }) {
      yield* sql`
        INSERT INTO computer_use_log (thread_id, app, action, detail, outcome, error, at)
        VALUES (${entry.threadId}, ${entry.app}, ${entry.action}, ${entry.detail}, ${entry.outcome},
          ${entry.error ?? null}, ${yield* now})
      `;
      yield* sql`
        DELETE FROM computer_use_log
        WHERE id <= (SELECT MAX(id) FROM computer_use_log) - ${MAX_LOG_ROWS}
      `;
    },
    // Failing to log must not hide the action, but it is worth knowing about.
    Effect.catch((error) => Effect.logWarning("Could not log a computer-use action", { error })),
  );

  const answer: ComputerUseService["Service"]["answer"] = Effect.fn("ComputerUseService.answer")(
    function* (input) {
      const deferred = waiting.get(input.id);
      if (deferred === undefined) {
        return yield* new ComputerUseError({ message: "This request is no longer waiting." });
      }
      yield* Deferred.succeed(deferred, input.answer);
    },
  );

  const ask = Effect.fn("ComputerUseService.ask")(function* (
    threadId: ThreadId,
    app: string,
    windowTitle: string,
  ) {
    const id = yield* random.uuidV4();
    const deferred = yield* Deferred.make<ComputerUseAnswerInput["answer"]>();
    const createdAt = yield* now;
    waiting.set(id, deferred);
    yield* SubscriptionRef.update(pendingRef, (requests) => [
      ...requests,
      {
        id,
        threadId,
        app: app as ComputerUseAppName,
        windowTitle: windowTitle.slice(0, 200),
        createdAt,
      },
    ]);
    return yield* Deferred.await(deferred).pipe(
      Effect.timeoutOption(ASK_TIMEOUT),
      Effect.ensuring(
        SubscriptionRef.update(pendingRef, (requests) =>
          requests.filter((request) => request.id !== id),
        ).pipe(Effect.andThen(Effect.sync(() => waiting.delete(id)))),
      ),
    );
  });

  const windows = helper.request("listWindows").pipe(
    Effect.flatMap(decodeWindows),
    Effect.map((result) => result.windows),
    Effect.mapError(
      (error) =>
        new ComputerUseRefused({
          message: error._tag === "ComputerUseHelperError" ? error.message : "Could not list apps.",
        }),
    ),
  );

  const requireEnabled = Effect.gen(function* () {
    if (!helper.supported) {
      return yield* new ComputerUseRefused({
        message: "Computer use is not available on this operating system yet.",
      });
    }
    const enabled = yield* readEnabled.pipe(Effect.orElseSucceed(() => false));
    if (!enabled) {
      return yield* new ComputerUseRefused({
        message:
          "Computer use is turned off. The user can turn it on in Settings → Computer use; do not ask them to work around it.",
      });
    }
  });

  const isApproved = Effect.fn("ComputerUseService.isApproved")(function* (
    threadId: ThreadId,
    app: string,
  ) {
    if ((yield* Ref.get(threadAllows)).has(`${threadId}|${app}`)) return true;
    const rows = yield* sql<{ readonly app: string }>`
        SELECT app FROM computer_use_apps WHERE app = ${app}
      `.pipe(Effect.orElseSucceed(() => []));
    return rows.length > 0;
  });

  /** The window's app, approved for this thread, or why not. */
  const approve = Effect.fn("ComputerUseService.approve")(function* (
    threadId: ThreadId,
    window: string,
  ) {
    const target = (yield* windows).find((candidate) => candidate.window === window);
    if (target === undefined) {
      return yield* new ComputerUseRefused({
        message: "That window is gone. Call computer_list_apps again.",
      });
    }
    if (isBlockedWindow(target.app, target.title) || !isAppName(target.app)) {
      return yield* new ComputerUseRefused({
        message: "Agents cannot use this window. Pick another app.",
      });
    }
    if (yield* isApproved(threadId, target.app)) return target;
    const answered = yield* ask(threadId, target.app, target.title);
    if (Option.isNone(answered)) {
      return yield* new ComputerUseRefused({
        message: `The user did not answer whether you may use ${target.app}. Ask them in chat first.`,
      });
    }
    if (answered.value === "deny") {
      return yield* new ComputerUseRefused({
        message: `The user declined to let you use ${target.app}.`,
      });
    }
    if (answered.value === "always_allow") {
      yield* sql`
          INSERT INTO computer_use_apps (app, added_at) VALUES (${target.app}, ${yield* now})
          ON CONFLICT (app) DO NOTHING
        `.pipe(
        Effect.catch((error) => Effect.logWarning("Could not save an allowed app", { error })),
      );
    } else {
      yield* Ref.update(
        threadAllows,
        (current) => new Set([...current, `${threadId}|${target.app}`]),
      );
    }
    // The user may have stopped computer use while the question was open.
    yield* requireEnabled;
    return target;
  });

  const markActive = Effect.fn("ComputerUseService.markActive")(function* (
    threadId: ThreadId,
    app: string,
  ) {
    const atMillis = yield* Clock.currentTimeMillis;
    yield* SubscriptionRef.update(activityRef, (entries) => [
      ...entries.filter((entry) => !(entry.threadId === threadId && entry.app === app)),
      { threadId, app, atMillis },
    ]);
  });

  const listApps: ComputerUseService["Service"]["listApps"] = Effect.fn(
    "ComputerUseService.listApps",
  )(function* (threadId) {
    yield* requireEnabled;
    const all = yield* windows;
    const visible = all.filter((window) => !isBlockedWindow(window.app, window.title));
    const allowed = new Set<string>();
    for (const window of visible) {
      if (yield* isApproved(threadId, window.app)) allowed.add(window.app);
    }
    yield* log({
      threadId,
      app: null,
      action: "list_apps",
      detail: `${visible.length} windows`,
      outcome: "done",
    });
    // Titles can name documents and mail; the agent sees them only for apps it may use.
    return visible.map((window) => ({
      ...window,
      title: allowed.has(window.app) ? window.title : "",
      approved: allowed.has(window.app),
    }));
  });

  const act: ComputerUseService["Service"]["act"] = Effect.fn("ComputerUseService.act")(
    function* (target, action, detail, args) {
      yield* requireEnabled;
      const window = yield* approve(target.threadId, target.window).pipe(
        Effect.tapError((refused) =>
          log({
            threadId: target.threadId,
            app: null,
            action,
            detail,
            outcome: "refused",
            error: refused.message,
          }),
        ),
      );
      yield* markActive(target.threadId, window.app);
      // The user may have pressed Stop while the checks above ran.
      yield* requireEnabled;
      return yield* helper.request(action, { ...args, window: target.window }).pipe(
        Effect.tap(() =>
          log({ threadId: target.threadId, app: window.app, action, detail, outcome: "done" }),
        ),
        Effect.catchTags({
          ComputerUseHelperError: (error) =>
            log({
              threadId: target.threadId,
              app: window.app,
              action,
              detail,
              outcome: "failed",
              error: error.message,
            }).pipe(
              Effect.andThen(Effect.fail(new ComputerUseRefused({ message: error.message }))),
            ),
        }),
      );
    },
  );

  const stop: ComputerUseService["Service"]["stop"] = setEnabled(false).pipe(
    Effect.asVoid,
    Effect.catch((error) =>
      // Even when the setting cannot be saved, nothing may keep running.
      Effect.logWarning("Could not save computer use as off", { error }).pipe(
        Effect.andThen(refuseWaiting),
        Effect.andThen(helper.stop),
      ),
    ),
  );

  // Ages out the "in use" indicator once a thread stops acting.
  yield* Effect.gen(function* () {
    const cutoff = (yield* Clock.currentTimeMillis) - ACTIVE_WINDOW_MS;
    const current = yield* SubscriptionRef.get(activityRef);
    if (current.some((entry) => entry.atMillis < cutoff)) {
      yield* SubscriptionRef.set(
        activityRef,
        current.filter((entry) => entry.atMillis >= cutoff),
      );
    }
  }).pipe(Effect.repeat(Schedule.spaced("5 seconds")), Effect.forkScoped);

  return ComputerUseService.of({
    state,
    setEnabled,
    removeApp,
    clearLog,
    pending: SubscriptionRef.changes(pendingRef).pipe(Stream.map((requests) => ({ requests }))),
    answer,
    activity: SubscriptionRef.changes(activityRef).pipe(
      Stream.map((entries) => ({
        active: entries.map((entry) => ({
          threadId: entry.threadId,
          app: entry.app as ComputerUseAppName,
          at: DateTime.formatIso(DateTime.makeUnsafe(entry.atMillis)),
        })),
      })),
    ),
    stop,
    listApps,
    act,
  });
});

export const layer = Layer.effect(ComputerUseService, make);

/** With the real helper process; tests provide their own helper to `layer`. */
export const layerLive = layer.pipe(Layer.provide(ComputerUseHelper.layer));
