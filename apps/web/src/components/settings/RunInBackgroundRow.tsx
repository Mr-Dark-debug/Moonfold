import { isMacPlatform } from "@moonfold/shared/keybindings";

import { updateClientSettings, useClientSettings } from "../../hooks/useSettings";
import { Switch } from "../ui/switch";
import { SettingsRow } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/**
 * Desktop on Windows and Linux: stay in the system tray after the last window closes, so
 * scheduled tasks keep running. macOS apps already keep running without windows.
 */
export function RunInBackgroundRow() {
  const enabled = useClientSettings((settings) => settings.desktopRunInBackground);

  if (isMacPlatform(navigator.platform)) return null;
  return (
    <SettingsRow
      {...searchableSetting("run-in-background")}
      description="When you close the last window, Moonfold stays in the system tray so scheduled tasks keep running."
      control={
        <Switch
          checked={enabled}
          onCheckedChange={(checked) =>
            void updateClientSettings({ desktopRunInBackground: Boolean(checked) })
          }
          aria-label="Keep running in the background"
        />
      }
    />
  );
}
