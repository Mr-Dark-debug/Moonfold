import { describe, expect, it } from "vite-plus/test";

import {
  cliArchiveTarCommand,
  cliReleaseChannelOf,
  crossesReleaseTrack,
  desktopUpdateChannelOf,
  newestCliReleaseVersion,
  parseChecksums,
  releaseDatabaseMigration,
} from "./cliRelease.ts";

describe("cliRelease", () => {
  it("parses sha256sum output including binary-mode markers", () => {
    const checksums = parseChecksums(
      [
        `${"a".repeat(64)}  moonfold-1.2.3-linux-x64.tar.gz`,
        `${"B".repeat(64)} *moonfold-1.2.3-win32-x64.zip`,
        "not a checksum line",
        "",
      ].join("\n"),
    );
    expect(checksums.get("moonfold-1.2.3-linux-x64.tar.gz")).toBe("a".repeat(64));
    expect(checksums.get("moonfold-1.2.3-win32-x64.zip")).toBe("b".repeat(64));
    expect(checksums.size).toBe(2);
  });

  it("extracts with the System32 bsdtar on Windows and plain tar elsewhere", () => {
    expect(cliArchiveTarCommand("linux", {})).toBe("tar");
    expect(cliArchiveTarCommand("win32", { SystemRoot: "D:\\Win" })).toBe(
      "D:\\Win\\System32\\tar.exe",
    );
    expect(cliArchiveTarCommand("win32", {})).toBe("C:\\Windows\\System32\\tar.exe");
  });

  it("picks the newest non-draft release on the requested channel", () => {
    const releases = [
      { tag_name: "v1.2.4-preview.20260912.9", draft: true },
      { tag_name: "v1.2.4-preview.20260912.8" },
      { tag_name: "v1.2.4-nightly.20260912.7" },
      { tag_name: "desktop-preview" },
      { tag_name: "v1.2.3" },
      { tag_name: "v1.2.3-nightly.20260911.2" },
    ];
    expect(newestCliReleaseVersion(releases, "preview")).toBe("1.2.4-preview.20260912.8");
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.2.4-nightly.20260912.7");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.2.3");
    expect(newestCliReleaseVersion([{ tag_name: "v1.2.3" }], "preview")).toBeUndefined();
  });

  it("puts Moonfold's betas on the testing track, apart from stable releases", () => {
    const releases = [
      { tag_name: "v1.0.1-beta.2" },
      { tag_name: "v1.0.0" },
      { tag_name: "v1.0.0-rc.1" },
    ];
    expect(newestCliReleaseVersion(releases, "nightly")).toBe("1.0.1-beta.2");
    expect(newestCliReleaseVersion(releases, "stable")).toBe("1.0.0");
    expect(cliReleaseChannelOf("0.1.0-alpha.3")).toBe("nightly");
    expect(desktopUpdateChannelOf("1.0.0-beta.6")).toBe("nightly");
    expect(desktopUpdateChannelOf("1.0.0")).toBe("latest");
    expect(crossesReleaseTrack("1.0.0-beta.6", "1.0.0")).toBe(true);
    expect(crossesReleaseTrack("1.0.0-beta.6", "1.0.0-beta.7")).toBe(false);
  });

  it("reads the database migration a release's notes declare", () => {
    expect(releaseDatabaseMigration("Notes\n\n<!-- moonfold:database-migration=86 -->\n")).toBe(86);
    expect(releaseDatabaseMigration("Notes without a marker")).toBeUndefined();
    expect(releaseDatabaseMigration(null)).toBeUndefined();
  });
});
