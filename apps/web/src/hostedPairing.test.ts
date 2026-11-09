import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildHostedPairingUrl,
  hasHostedPairingRequest,
  isHostedStaticApp,
  readHostedPairingRequest,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads hosted pairing host and query token parameters", () => {
    const url = new URL("https://app.example.org/pair?host=100.64.1.2:3773&token=ABCD1234");

    expect(readHostedPairingRequest(url)).toEqual({
      host: "100.64.1.2:3773",
      token: "ABCD1234",
      label: "",
    });
    expect(hasHostedPairingRequest(url)).toBe(true);
  });

  it("prefers hash tokens so generated hosted links do not put credentials in search params", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.example.org");

    const link = buildHostedPairingUrl({
      host: "https://backend.example.com:3773",
      token: "pairing-token",
      label: "Workstation",
    });
    if (link === null) throw new Error("Expected a hosted pairing link");
    const url = new URL(link);

    expect(url.origin).toBe("https://preview.example.org");
    expect(url.pathname).toBe("/pair");
    expect(url.searchParams.get("host")).toBe("https://backend.example.com:3773");
    expect(url.searchParams.get("label")).toBe("Workstation");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=pairing-token");
  });

  it("builds no hosted pairing link when the build has no hosted app", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "");

    expect(
      buildHostedPairingUrl({ host: "https://backend.example.com:3773", token: "pairing-token" }),
    ).toBeNull();
    expect(isHostedStaticApp(new URL("https://backend.example.com/"))).toBe(false);
  });
});
