import type { AuthMobileAccessStatus } from "@moonfold/contracts";

/**
 * What the Moonfold mobile app's QR code says (D-58): where the host is, which certificate to
 * trust, and a one-time pairing token. With Reach from anywhere (D-69) it also names the relay
 * and the room, which older apps ignore. Null while there is no way to reach the listener.
 */
export function mobilePairingPayload(
  status: AuthMobileAccessStatus,
  token: string,
  hostName: string,
): string | null {
  const relay =
    status.anywhere?.relayUrl != null && status.anywhere.room !== null
      ? { relay: status.anywhere.relayUrl, room: status.anywhere.room }
      : null;
  if (
    !status.enabled ||
    status.port === null ||
    status.certificateSha256 === null ||
    (status.addresses.length === 0 && relay === null)
  ) {
    return null;
  }
  const query = new URLSearchParams({
    v: "1",
    hosts: status.addresses.join(","),
    port: String(status.port),
    sha256: status.certificateSha256,
    token,
    name: hostName,
    ...relay,
  });
  return `moonfold://mobile-pair?${query.toString()}`;
}
