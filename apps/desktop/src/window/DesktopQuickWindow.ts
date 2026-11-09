/**
 * DesktopQuickWindow - the global hotkey that opens the quick window, a small always-on-top
 * window for starting a thread from anywhere. The hotkey is off until the user records one.
 * It also applies the background-mode client setting.
 *
 * @module window/DesktopQuickWindow
 */
import {
  DEFAULT_CLIENT_SETTINGS,
  type ClientSettings,
  type SnapShotKeyChord,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Electron from "electron";

import * as DesktopClientSettings from "../settings/DesktopClientSettings.ts";
import { toElectronAccelerator } from "../snapShot/snapShot.ts";
import * as DesktopWindow from "./DesktopWindow.ts";

export const DesktopQuickWindowStatus = Schema.Struct({
  /** The accelerator Moonfold holds, or null when the hotkey is off or could not be taken. */
  accelerator: Schema.NullOr(Schema.String),
  /** Why the chosen hotkey is not active. */
  message: Schema.NullOr(Schema.String),
});
export type DesktopQuickWindowStatus = typeof DesktopQuickWindowStatus.Type;

export class DesktopQuickWindow extends Context.Service<
  DesktopQuickWindow,
  {
    readonly initialize: Effect.Effect<void>;
    readonly configure: (settings: ClientSettings) => Effect.Effect<void>;
    /** Releases the hotkey while the user records a new one, so the keys reach the page. */
    readonly setSuppressed: (suppressed: boolean) => Effect.Effect<void>;
    readonly status: Effect.Effect<DesktopQuickWindowStatus>;
  }
>()("@moonfold/desktop/window/DesktopQuickWindow") {}

const make = Effect.gen(function* () {
  const clientSettings = yield* DesktopClientSettings.DesktopClientSettings;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const services = yield* Effect.context<never>();
  const runFork = Effect.runForkWith(services);
  const statusRef = yield* Ref.make<DesktopQuickWindowStatus>({ accelerator: null, message: null });
  let shortcut: SnapShotKeyChord | null = null;
  let suppressed = false;
  let registered: string | null = null;

  const release = () => {
    if (registered !== null) Electron.globalShortcut.unregister(registered);
    registered = null;
  };

  const apply = Effect.sync((): DesktopQuickWindowStatus => {
    release();
    if (shortcut === null || suppressed) return { accelerator: null, message: null };
    const accelerator = toElectronAccelerator(shortcut);
    let taken = false;
    try {
      taken = Electron.globalShortcut.register(accelerator, () => {
        runFork(desktopWindow.toggleQuickWindow.pipe(Effect.ignoreCause({ log: true })));
      });
    } catch {
      return { accelerator: null, message: "The system could not register this shortcut." };
    }
    if (!taken) {
      return {
        accelerator: null,
        message: "This shortcut is already used by the system or another app.",
      };
    }
    registered = accelerator;
    return { accelerator, message: null };
  }).pipe(Effect.flatMap((status) => Ref.set(statusRef, status)));

  const configure: DesktopQuickWindow["Service"]["configure"] = (settings) =>
    desktopWindow
      .setRunInBackground(settings.desktopRunInBackground)
      .pipe(Effect.andThen(configureShortcut(settings)));

  const configureShortcut = (settings: ClientSettings) =>
    Effect.suspend(() => {
      const next = settings.quickWindowShortcut;
      const unchanged =
        next === null || shortcut === null
          ? next === shortcut
          : toElectronAccelerator(next) === toElectronAccelerator(shortcut);
      if (unchanged && (registered !== null || next === null)) return Effect.void;
      shortcut = next;
      return apply;
    });

  yield* Effect.addFinalizer(() => Effect.sync(release));

  return DesktopQuickWindow.of({
    initialize: clientSettings.get.pipe(
      Effect.flatMap((stored) =>
        configure(Option.getOrElse(stored, () => DEFAULT_CLIENT_SETTINGS)),
      ),
      Effect.ignore,
    ),
    configure,
    setSuppressed: Effect.fn("DesktopQuickWindow.setSuppressed")(function* (next: boolean) {
      if (suppressed === next) return;
      suppressed = next;
      yield* apply;
    }),
    status: Ref.get(statusRef),
  });
});

export const layer = Layer.effect(DesktopQuickWindow, make);
