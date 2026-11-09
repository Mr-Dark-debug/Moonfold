import type { DesktopQuickWindowStatus, SnapShotKeyChord } from "@moonfold/contracts";
import { parseKeybindingShortcut } from "@moonfold/shared/keybindings";
import { useEffect, useState, type KeyboardEvent } from "react";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { formatSnapShotShortcutLabel } from "../../lib/snapShotShortcut";
import { SnapShotShortcutKeys } from "../desktop/SnapShotShortcutKeys";
import { Button } from "../ui/button";
import { keybindingFromKeyboardEvent } from "./KeybindingsSettings.logic";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * The global hotkey for the desktop quick window. While recording, the desktop app lets go of
 * the current hotkey so pressing it again reaches this page instead of toggling the window.
 */
export function QuickWindowShortcutRow() {
  const bridge = typeof window === "undefined" ? undefined : window.desktopBridge;
  const shortcut = useClientSettings((settings) => settings.quickWindowShortcut);

  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<DesktopQuickWindowStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = async () => {
    const read = bridge?.getQuickWindowStatus;
    if (!read) return;
    setStatus(await read().catch(() => null));
  };
  // The desktop app applies the saved hotkey at startup; read whether it took it once here,
  // and again after each save.
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- asks the desktop app whether it registered the saved hotkey and ignores the answer after unmount
  useEffect(() => {
    let live = true;
    void bridge
      ?.getQuickWindowStatus?.()
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [bridge]);

  const stopRecording = () => {
    setRecording(false);
    void bridge?.setQuickWindowShortcutSuppressed?.(false).catch(() => undefined);
  };
  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- gives the global hotkey back to the desktop app when the row unmounts mid-recording
  useEffect(
    () => () => void bridge?.setQuickWindowShortcutSuppressed?.(false).catch(() => undefined),
    [bridge],
  );

  if (bridge?.getQuickWindowStatus === undefined) return null;

  const save = async (next: SnapShotKeyChord | null) => {
    setError(null);
    try {
      await updateClientSettings({ quickWindowShortcut: next });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Couldn't save the shortcut.");
    }
    await refreshStatus();
  };

  const record = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || event.key === "Tab" || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      stopRecording();
      return;
    }
    // A global hotkey without a modifier would take that key from every app.
    if (!event.metaKey && !event.ctrlKey && !event.altKey) return;
    const input = keybindingFromKeyboardEvent(event, navigator.platform);
    const next = input ? parseKeybindingShortcut(input) : null;
    if (!next) return;
    stopRecording();
    void save(next);
  };

  const unavailable = shortcut !== null && status !== null && status.accelerator === null;
  return (
    <SettingsRow
      {...searchableSetting("quick-window-shortcut")}
      description={
        <span role="status">
          {error ??
            (unavailable
              ? (status.message ?? "This shortcut is not active.")
              : "Opens a small window on top of other apps for starting a thread.")}
        </span>
      }
      control={
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant={recording ? "secondary" : "outline"}
            aria-label={
              recording
                ? "Press a shortcut that includes a modifier key"
                : shortcut
                  ? `Record quick window shortcut, currently ${formatSnapShotShortcutLabel(shortcut)}`
                  : "Record quick window shortcut"
            }
            aria-pressed={recording}
            data-keybinding-capture=""
            onClick={() => {
              setRecording(true);
              void bridge.setQuickWindowShortcutSuppressed?.(true).catch(() => undefined);
            }}
            onKeyDown={record}
            onBlur={stopRecording}
          >
            {recording ? (
              "Press shortcut…"
            ) : shortcut ? (
              <SnapShotShortcutKeys shortcut={shortcut} />
            ) : (
              "Set shortcut"
            )}
          </Button>
          {shortcut ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => void save(null)}>
              Turn off
            </Button>
          ) : null}
        </div>
      }
    />
  );
}
