import { describe, expect, it } from "vite-plus/test";

import { electronUpdaterChannelSettings, isNightlyDesktopVersion } from "./updateChannels.ts";

describe("updateChannels", () => {
  it("keeps preview builds branded as nightly", () => {
    expect(isNightlyDesktopVersion("0.0.41-preview.20260911.7")).toBe(true);
    expect(isNightlyDesktopVersion("0.0.41-nightly.20260911.7")).toBe(true);
  });

  it("maps Beta to electron-updater's beta channel and Stable to the latest release", () => {
    // An unset or "latest" channel on a beta install makes electron-updater skip every -beta.N.
    expect(electronUpdaterChannelSettings("nightly")).toEqual({
      channel: "beta",
      allowPrerelease: true,
      fullChangelog: true,
    });
    expect(electronUpdaterChannelSettings("latest")).toEqual({
      channel: "latest",
      allowPrerelease: false,
      fullChangelog: false,
    });
  });

  it("only matches the first prerelease identifier", () => {
    expect(isNightlyDesktopVersion("1.2.3-foo-preview.20260911.1")).toBe(false);
    expect(isNightlyDesktopVersion("1.2.3")).toBe(false);
  });
});
