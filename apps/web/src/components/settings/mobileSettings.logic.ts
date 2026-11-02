import type { AuthMobileAccessStatus } from "@moonfold/contracts";

/**
 * What the Moonfold mobile app's QR code says (D-58): where the host is, which certificate to
 * trust, and a one-time pairing token. Null while the listener has no address to offer.
 */
export function mobilePairingPayload(
  status: AuthMobileAccessStatus,
  token: string,
  hostName: string,
): string | null {
  if (
    !status.enabled ||
    status.port === null ||
    status.certificateSha256 === null ||
    status.addresses.length === 0
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
  });
  return `moonfold://mobile-pair?${query.toString()}`;
}
