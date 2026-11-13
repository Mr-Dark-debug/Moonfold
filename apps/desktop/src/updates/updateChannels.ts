import type { DesktopUpdateChannel } from "@moonfold/contracts";

// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

export interface ElectronUpdaterChannelSettings {
  /** The channel electron-updater is given; it decides which GitHub releases count. */
  readonly channel: string;
  readonly allowPrerelease: boolean;
  readonly fullChangelog: boolean;
}

/**
 * Beta ("nightly" in code, D-76) is electron-updater's "beta" channel: newest beta or stable.
 * Stable is GitHub's latest release, never a beta once a stable exists. Always set the channel:
 * electron-updater keeps it, and one read from a stable version finds no betas after a switch.
 */
export function electronUpdaterChannelSettings(
  channel: DesktopUpdateChannel,
): ElectronUpdaterChannelSettings {
  const testing = channel === "nightly";
  return {
    channel: testing ? "beta" : "latest",
    allowPrerelease: testing,
    fullChangelog: testing,
  };
}
