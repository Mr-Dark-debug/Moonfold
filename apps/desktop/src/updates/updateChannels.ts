import type { DesktopUpdateChannel } from "@moonfold/contracts";

// Preview builds share nightly branding but ship without an update feed.
const PRERELEASE_VERSION_PATTERN = /^[^-+]+-(?:nightly|preview)\.\d{8}\.\d+$/;

export function isNightlyDesktopVersion(version: string): boolean {
  return PRERELEASE_VERSION_PATTERN.test(version);
}

// Moonfold's betas (`0.1.0-beta.1`) are GitHub prereleases on the latest channel. A beta install
// has to accept prereleases, or the GitHub feed never offers it the next beta.
const TESTING_RELEASE_VERSION_PATTERN = /^[^-+]+-(?:alpha|beta|rc)\.\d+$/;

export function isTestingReleaseVersion(version: string): boolean {
  return TESTING_RELEASE_VERSION_PATTERN.test(version);
}

export interface ElectronUpdaterChannelSettings {
  /** The channel to give electron-updater, or null to leave it unset. */
  readonly channel: DesktopUpdateChannel | null;
  readonly allowPrerelease: boolean;
  readonly fullChangelog: boolean;
}

/**
 * How electron-updater must be configured for a channel and the running version.
 *
 * A beta on the latest channel leaves electron-updater's channel unset. electron-updater's GitHub
 * provider (6.x), with prereleases allowed, only accepts a release whose prerelease id matches the
 * channel or is alpha/beta when the channel itself is alpha/beta. An explicit "latest" therefore
 * skips every `-beta.N` release and reports "No published versions on GitHub", which is why
 * 0.1.0-beta.1 and beta.2 never saw an update. Unset, the channel comes from the running version
 * ("beta"), which accepts newer betas and stable releases; the manifest falls back to latest.yml.
 */
export function electronUpdaterChannelSettings(
  channel: DesktopUpdateChannel,
  appVersion: string,
): ElectronUpdaterChannelSettings {
  const nightly = channel === "nightly";
  const testingRelease = isTestingReleaseVersion(appVersion);
  return {
    channel: testingRelease && !nightly ? null : channel,
    allowPrerelease: nightly || testingRelease,
    fullChangelog: nightly,
  };
}
