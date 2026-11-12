import type { AuthMobileAccessStatus } from "@moonfold/contracts";
import { AnywhereRelayUrl, DEFAULT_ANYWHERE_RELAY_URL } from "@moonfold/contracts/settings";
import * as Schema from "effect/Schema";
import { RefreshCwIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { createServerPairingCredential, fetchMobileAccessStatus } from "../../environments/primary";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { QRCodeSvg } from "../ui/qr-code";
import { Switch } from "../ui/switch";
import { mobilePairingPayload } from "./mobileSettings.logic";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";

/** A pairing token lasts five minutes on the server, so the code renews before that. */
const QR_REFRESH_MS = 4 * 60_000;
/** The listener starts a moment after the setting changes. */
const STATUS_POLL_MS = 1_000;
const STATUS_POLL_ATTEMPTS = 8;
const isAnywhereRelayUrl = Schema.is(AnywhereRelayUrl);

/**
 * Settings > Mobile App (D-58): turn on the phone's encrypted connection to this machine and show
 * the QR code that pairs it. Paired phones are listed and revoked in Settings > Connections.
 */
export function MobileSettingsPanel() {
  const environment = usePrimaryEnvironment();
  const enabled = usePrimarySettings((settings) => settings.mobileAccessEnabled);
  const anywhereEnabled = usePrimarySettings((settings) => settings.anywhereEnabled);
  const relayUrl = usePrimarySettings((settings) => settings.anywhereRelayUrl);
  const [relayError, setRelayError] = useState<string | null>(null);
  const updateSettings = useUpdatePrimarySettings();
  const [status, setStatus] = useState<AuthMobileAccessStatus | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostName = environment?.label ?? "Moonfold";

  // `ready` says when the status shows a change just saved; the server applies it a beat later.
  const refresh = useStableCallback(async (ready?: (status: AuthMobileAccessStatus) => boolean) => {
    try {
      const settled = (status: AuthMobileAccessStatus) =>
        status.enabled && (ready === undefined || ready(status));
      let current = await fetchMobileAccessStatus();
      for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS && !settled(current); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, STATUS_POLL_MS));
        current = await fetchMobileAccessStatus();
      }
      setStatus(current);
      if (!current.enabled) {
        setPayload(null);
        setError("The connection did not start. Check that a port near Moonfold's is free.");
        return;
      }
      const credential = await createServerPairingCredential({ mobile: true });
      setError(null);
      setPayload(mobilePairingPayload(current, credential.credential, hostName));
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "This machine did not answer.");
    }
  });

  // oxlint-disable-next-line moonfold/no-unreasoned-state-sync -- fetches the pairing code while the connection is on and renews it on a timer before the server token expires
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), QR_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

  const relayState = status?.anywhere;
  const anywhereStatus = !anywhereEnabled
    ? undefined
    : relayState === undefined
      ? "Starting…"
      : relayState.relayUrl === null
        ? "Enter a relay address below."
        : relayState.connected
          ? `Connected to ${new URL(relayState.relayUrl).host}. Phones paired from now on can reach this machine anywhere.`
          : `Connecting to ${new URL(relayState.relayUrl).host}…`;

  return (
    <SettingsPageContainer>
      <SettingsSection title="Mobile app">
        <SettingsRow
          {...searchableSetting("mobile-app")}
          description="Follow and drive this machine from the Moonfold Android app. There is no account: scan the code once, and the phone stays paired while Moonfold runs here."
          control={
            <Switch
              aria-label="Allow the mobile app to connect"
              checked={enabled}
              onCheckedChange={(checked) => {
                if (!checked) {
                  setStatus(null);
                  setPayload(null);
                  setError(null);
                }
                updateSettings({ mobileAccessEnabled: checked });
              }}
            />
          }
        />
        {enabled ? (
          <SettingsRow
            {...searchableSetting("mobile-anywhere")}
            description="Reach this machine from the phone on any network, with no account. A relay passes the encrypted connection along: it sees when the two talk and how much, never what."
            status={anywhereStatus}
            control={
              <Switch
                aria-label="Reach from anywhere"
                checked={anywhereEnabled}
                onCheckedChange={(checked) => {
                  updateSettings({ anywhereEnabled: checked });
                  // The code names the relay, so it is made again once the change applies.
                  void refresh((current) => (current.anywhere !== undefined) === checked);
                }}
              />
            }
          />
        ) : null}
        {enabled && anywhereEnabled ? (
          <SettingsRow
            title="Relay"
            description={
              DEFAULT_ANYWHERE_RELAY_URL === null
                ? "The wss:// address of a relay you run with `moonfold relay`, or one you trust."
                : "Leave empty to use Moonfold's relay, or enter the wss:// address of your own."
            }
            control={
              <DraftInput
                nativeInput
                size="sm"
                className="w-full sm:w-72"
                aria-label="Relay address"
                placeholder={DEFAULT_ANYWHERE_RELAY_URL ?? "wss://relay.example.com"}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={512}
                value={relayUrl ?? ""}
                onCommit={(next) => {
                  const trimmed = next.trim();
                  if (trimmed !== "" && !isAnywhereRelayUrl(trimmed)) {
                    setRelayError("Enter a wss:// address, without a query or a password.");
                    return;
                  }
                  setRelayError(null);
                  updateSettings({ anywhereRelayUrl: trimmed === "" ? null : trimmed });
                  const expected = (trimmed === "" ? DEFAULT_ANYWHERE_RELAY_URL : trimmed) ?? "";
                  const bare = (url: string) => url.replace(/\/+$/, "");
                  void refresh(
                    (current) => bare(current.anywhere?.relayUrl ?? "") === bare(expected),
                  );
                }}
              />
            }
          >
            {relayError !== null ? (
              <p role="alert" className="text-destructive-foreground pb-3 text-sm">
                {relayError}
              </p>
            ) : null}
          </SettingsRow>
        ) : null}
        {enabled ? (
          <SettingsRow
            title="Pair a phone"
            description={
              anywhereEnabled
                ? "Scan this code in the Moonfold app. The phone connects directly on the same network and through the relay anywhere else, encrypted end to end to this machine."
                : "Scan this code in the Moonfold app. The phone needs the same Wi-Fi, Tailscale or a VPN, or Reach from anywhere. It is encrypted and trusts only this machine."
            }
          >
            <div className="mt-3 flex flex-col items-start gap-3 pb-3.5">
              {payload !== null ? (
                <div className="rounded-xl border border-border/60 bg-white p-3">
                  <QRCodeSvg
                    value={payload}
                    size={280}
                    level="M"
                    marginSize={2}
                    title="Scan with the Moonfold mobile app"
                  />
                </div>
              ) : error === null && status?.addresses.length === 0 && !anywhereEnabled ? (
                <p className="text-muted-foreground text-sm">
                  This machine has no network address another device could use. Connect it to Wi-Fi
                  or a VPN.
                </p>
              ) : error === null ? (
                <p className="text-muted-foreground text-sm">Starting the connection…</p>
              ) : null}
              {error !== null ? (
                <p role="alert" className="text-destructive-foreground text-sm">
                  {error}
                </p>
              ) : null}
              {status !== null && status.addresses.length > 0 ? (
                <p className="text-muted-foreground text-xs">
                  Reachable at {status.addresses.join(", ")} on port {status.port}. The code renews
                  every few minutes and works once.
                </p>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  void refresh();
                }}
              >
                <RefreshCwIcon />
                New code
              </Button>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsSection>
    </SettingsPageContainer>
  );
}
