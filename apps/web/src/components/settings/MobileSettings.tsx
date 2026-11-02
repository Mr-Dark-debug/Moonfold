import type { AuthMobileAccessStatus } from "@moonfold/contracts";
import { RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { createServerPairingCredential, fetchMobileAccessStatus } from "../../environments/primary";
import { usePrimarySettings, useUpdatePrimarySettings } from "../../hooks/useSettings";
import { usePrimaryEnvironment } from "../../state/environments";
import { Button } from "../ui/button";
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

/**
 * Settings > Mobile App (D-58): turn on the phone's encrypted connection to this machine and show
 * the QR code that pairs it. Paired phones are listed and revoked in Settings > Connections.
 */
export function MobileSettingsPanel() {
  const environment = usePrimaryEnvironment();
  const enabled = usePrimarySettings((settings) => settings.mobileAccessEnabled);
  const updateSettings = useUpdatePrimarySettings();
  const [status, setStatus] = useState<AuthMobileAccessStatus | null>(null);
  const [payload, setPayload] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hostName = environment?.label ?? "Moonfold";

  const refresh = useCallback(async () => {
    setError(null);
    try {
      let current = await fetchMobileAccessStatus();
      for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS && !current.enabled; attempt += 1) {
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
      setPayload(mobilePairingPayload(current, credential.credential, hostName));
    } catch (cause) {
      setPayload(null);
      setError(cause instanceof Error ? cause.message : "This machine did not answer.");
    }
  }, [hostName]);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      setPayload(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), QR_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [enabled, refresh]);

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
              onCheckedChange={(checked) => updateSettings({ mobileAccessEnabled: checked })}
            />
          }
        />
        {enabled ? (
          <SettingsRow
            title="Pair a phone"
            description="Open Moonfold on the phone and scan this code. The phone must be able to reach this machine: same Wi-Fi, Tailscale or a VPN. The connection is encrypted, and the phone trusts this machine's certificate only."
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
              ) : error === null && status?.addresses.length === 0 ? (
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
              <Button size="sm" variant="outline" onClick={() => void refresh()}>
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
