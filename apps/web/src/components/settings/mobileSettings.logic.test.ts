import { describe, expect, it } from "vite-plus/test";

import { mobilePairingPayload } from "./mobileSettings.logic";

const status = {
  enabled: true,
  port: 13774,
  certificateSha256: "ab".repeat(32),
  addresses: ["192.168.1.5", "100.64.1.2"],
};

describe("mobilePairingPayload", () => {
  it("carries the hosts, port, certificate and token", () => {
    const payload = mobilePairingPayload(status, "TOKEN123", "My laptop");
    const url = new URL(payload ?? "");
    expect(url.protocol).toBe("moonfold:");
    expect(url.host).toBe("mobile-pair");
    expect(url.searchParams.get("hosts")).toBe("192.168.1.5,100.64.1.2");
    expect(url.searchParams.get("port")).toBe("13774");
    expect(url.searchParams.get("sha256")).toBe(status.certificateSha256);
    expect(url.searchParams.get("token")).toBe("TOKEN123");
    expect(url.searchParams.get("name")).toBe("My laptop");
  });

  it("has nothing to offer while the listener is off or has no address", () => {
    expect(mobilePairingPayload({ ...status, enabled: false }, "T", "x")).toBeNull();
    expect(mobilePairingPayload({ ...status, port: null }, "T", "x")).toBeNull();
    expect(mobilePairingPayload({ ...status, addresses: [] }, "T", "x")).toBeNull();
  });
  it("names the relay and room for Reach from anywhere, even with no local address", () => {
    const anywhere = { relayUrl: "wss://relay.example.dev", room: "R".repeat(43), connected: true };
    const url = new URL(
      mobilePairingPayload({ ...status, addresses: [], anywhere }, "T", "x") ?? "moonfold://none",
    );
    expect(url.searchParams.get("relay")).toBe("wss://relay.example.dev");
    expect(url.searchParams.get("room")).toBe("R".repeat(43));
    expect(url.searchParams.get("hosts")).toBe("");
    // Without a relay address the code stays a local-network one.
    const local = new URL(
      mobilePairingPayload({ ...status, anywhere: { ...anywhere, relayUrl: null } }, "T", "x")!,
    );
    expect(local.searchParams.has("relay")).toBe(false);
  });
});
