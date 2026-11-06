import type { EnvironmentId, UnifiedSettings } from "@moonfold/contracts";
import { useAtomValue } from "@effect/atom-react";
import { useState } from "react";

import { useUpdateEnvironmentSettings } from "../../hooks/useSettings";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { searchableSetting } from "./settingsSearch";
import { SettingsRow, SettingsSection } from "./settingsLayout";

/**
 * Account-usage options for the selected device. Usage hubs (CLIProxyAPI) are not supported:
 * they pool provider logins, which Moonfold never does. A hub saved by an older build is still
 * listed so its stored management key can be removed.
 */
export function UsageProviderSettings({
  environmentId,
  sources,
  cursorKeychainUsageEnabled,
  claudeResetCreditsEnabled,
  readOnly,
}: {
  readonly environmentId: EnvironmentId;
  readonly sources: UnifiedSettings["usageLimitSources"];
  readonly cursorKeychainUsageEnabled: boolean;
  readonly claudeResetCreditsEnabled: boolean;
  readonly readOnly: boolean;
}) {
  const updateSettings = useUpdateEnvironmentSettings(environmentId);
  const updateCursorSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "update Cursor account usage",
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const platform = useAtomValue(serverEnvironment.configValueAtom(environmentId))?.environment
    .platform;
  const [updatingCursor, setUpdatingCursor] = useState(false);
  const entries = Object.entries(sources);

  const setUsageSetting = async (
    patch: { cursorKeychainUsageEnabled: boolean } | { claudeResetCreditsEnabled: boolean },
  ) => {
    setUpdatingCursor(true);
    const result = await updateCursorSettings({ environmentId, input: { patch } });
    if (result._tag === "Success") {
      await refreshProviders({ environmentId, input: {} });
    }
    setUpdatingCursor(false);
  };

  return (
    <>
      <SettingsSection {...searchableSetting("usage-providers")}>
        {platform?.os === "darwin" ? (
          <SettingsRow
            id="cursor-keychain-usage"
            title="Cursor account usage"
            description="Read your existing Cursor CLI login from macOS Keychain to show account history and monthly limits. macOS may ask you to allow access."
            control={
              <Switch
                aria-label="Cursor account usage"
                checked={cursorKeychainUsageEnabled}
                disabled={readOnly || updatingCursor}
                onCheckedChange={(enabled) =>
                  void setUsageSetting({ cursorKeychainUsageEnabled: enabled })
                }
              />
            }
          />
        ) : null}
        {platform?.os !== "darwin" ? (
          <SettingsRow
            id="claude-reset-credits"
            title="Claude banked resets"
            description="Read the Claude CLI's stored login on this machine to show and use banked usage resets. Moonfold sends it only to Anthropic."
            control={
              <Switch
                aria-label="Claude banked resets"
                checked={claudeResetCreditsEnabled}
                disabled={readOnly || updatingCursor}
                onCheckedChange={(enabled) =>
                  void setUsageSetting({ claudeResetCreditsEnabled: enabled })
                }
              />
            }
          />
        ) : null}
        {entries.length === 0
          ? null
          : entries.map(([id, source]) => {
              const label = source.label?.trim() || source.url;
              return (
                <SettingsRow
                  key={id}
                  title={label}
                  description={
                    <span className="break-all">
                      No longer read: usage hubs pool provider logins, which Moonfold does not
                      support. Remove it to delete its stored management key.
                    </span>
                  }
                  control={
                    !readOnly ? (
                      <RemoveUsageProviderButton
                        label={label}
                        onConfirm={() => updateSettings({ usageLimitSources: { [id]: null } })}
                      />
                    ) : null
                  }
                />
              );
            })}
      </SettingsSection>
    </>
  );
}

function RemoveUsageProviderButton({
  label,
  onConfirm,
}: {
  readonly label: string;
  readonly onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Remove ${label}`}
        onClick={() => setOpen(true)}
      >
        Remove
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {label}?</AlertDialogTitle>
            <AlertDialogDescription>
              The hub's management key is deleted from this server. Its accounts leave the Limits
              view; the hub itself is untouched. Add it again with the URL and key to bring them
              back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setOpen(false);
                onConfirm();
              }}
            >
              Remove hub
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
