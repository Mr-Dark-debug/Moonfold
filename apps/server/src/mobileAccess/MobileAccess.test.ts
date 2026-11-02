// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Exercises the real X.509 parser.
import { describe, expect, it } from "@effect/vitest";
import * as NodeCrypto from "node:crypto";

import {
  certificateSha256,
  generateSelfSignedCertificate,
  shareableAddresses,
} from "./MobileAccess.ts";

const nic = (address: string, internal = false, family: "IPv4" | "IPv6" = "IPv4") =>
  ({ address, internal, family }) as never;

describe("mobile access", () => {
  it("offers LAN addresses first, then tailnet, and never loopback or link-local", () => {
    expect(
      shareableAddresses({
        lo: [nic("127.0.0.1", true)],
        tailscale0: [nic("100.64.1.2")],
        wifi: [nic("192.168.1.5"), nic("fe80::1", false, "IPv6")],
        broken: [nic("169.254.3.4")],
      }),
    ).toEqual(["192.168.1.5", "100.64.1.2"]);
  });

  it("creates a valid self-signed certificate and fingerprints its DER bytes", () => {
    const now = new Date("2026-11-02T12:00:00.000Z");
    const { cert, key } = generateSelfSignedCertificate(now);
    const parsed = new NodeCrypto.X509Certificate(cert);
    expect(parsed.subject).toBe("CN=Moonfold");
    expect(parsed.verify(parsed.publicKey)).toBe(true);
    expect(parsed.checkPrivateKey(NodeCrypto.createPrivateKey(key))).toBe(true);
    expect(new Date(parsed.validFrom).toISOString()).toBe("2026-11-02T12:00:00.000Z");
    expect(certificateSha256(cert)).toBe(
      NodeCrypto.createHash("sha256").update(parsed.raw).digest("hex"),
    );
  });
});
