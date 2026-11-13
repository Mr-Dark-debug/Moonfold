# Release

Releases are built by `.github/workflows/release.yml` on GitHub-hosted runners and published to
this repository's GitHub Releases. Nothing is published to T3's hosting, update feeds or package
accounts; those upstream workflows were removed in Phase 1.

## Cut a release

1. Write the release notes in `docs/releases/v<version>.md` (the publish job fails without them)
   and merge them to `main`.
2. Optional dry run: push the commit to a branch named `release-dry-run/<version>`, for example
   `git push origin HEAD:refs/heads/release-dry-run/0.1.0-beta.2`. It builds every target and
   uploads the result as a workflow artifact named `release-<version>`, without publishing.
3. Run the REA gate on the dry-run artifacts (docs/REA.md) and record it in `docs/REA-<tag>.md`.
4. Tag and push: `git tag v0.1.0-beta.2 && git push origin v0.1.0-beta.2`. Until 1.0,
   `X.Y.Z-beta.N` and `X.Y.Z` publish as full releases marked latest, so the repository page
   lists them; only `-alpha.N` versions publish as GitHub prereleases. Clients find versions by
   listing releases, so this flag only changes how GitHub displays a release.

The workflow can also be started by hand from the Actions tab with a version and a `publish`
switch, once it is on `main`.

## What a release contains

| Asset                                                                                                                                                                                                           | Built on                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `Moonfold-<version>-arm64.dmg`, `-x64.dmg`, and the matching `.zip` the updater downloads                                                                                                                       | macos-15, macos-15-intel                |
| `Moonfold-<version>-x64.exe`, `-arm64.exe` (NSIS installers)                                                                                                                                                    | windows-2025, windows-11-arm            |
| `Moonfold-<version>-x86_64.AppImage`, `-amd64.deb`, `-arm64.AppImage`, `-arm64.deb`                                                                                                                             | ubuntu-24.04, ubuntu-24.04-arm          |
| `moonfold-<version>-<platform>-<arch>.tar.gz` (Windows `.zip`) CLI archives for linux-x64, linux-arm64, darwin-arm64, win32-x64 and win32-arm64; none for Intel macOS, where the Node single-executable crashes | the same runners                        |
| `latest-mac.yml`, `latest.yml`, `latest-linux.yml`, `latest-linux-arm64.yml` and `.blockmap` files                                                                                                              | the desktop updater's feed              |
| `moonfold-<version>-sbom.cdx.json`                                                                                                                                                                              | CycloneDX SBOM from the lockfile (Syft) |
| `SHA256SUMS`                                                                                                                                                                                                    | every file above                        |

The CLI archives are what `scripts/install.sh` and `scripts/install.ps1` download; they check each
archive against `SHA256SUMS`. Windows installers embed the Linux CLI archive of the same
architecture as the WSL runtime, so the Linux job runs first.

## Updates

Desktop builds made in CI get an electron-builder `publish` entry for this repository
(`GITHUB_REPOSITORY`), so installed apps update from these GitHub Releases. Local builds have no
feed. An `-alpha.N` or `-beta.N` install accepts prereleases, so it moves to the next beta and
then to the stable release; a stable install only sees stable releases. electron-updater treats
any other label as its own channel: an `-rc.N` install would only ever be offered later `-rc.N`
builds, and beta installs never see it. The workflow refuses those versions (1.0.0-rc.1 shipped
before this rule and was replaced by 1.0.0-beta.6).

Moonfold does not publish nightly or preview channels; the workflow refuses those versions.

## Signing

Betas are unsigned. The build jobs sign only when the secrets below exist, so adding them is the
whole switch.

| Platform | What the owner needs                                                                                                                                                                                               | Repository secrets / variables                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS    | Apple Developer Program membership (paid, yearly), a Developer ID Application certificate, an App Store Connect API key for notarization, and a provisioning profile                                               | `CSC_LINK` (base64 .p12), `CSC_KEY_PASSWORD`, `APPLE_API_KEY` (.p8 contents), `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`, `MACOS_PROVISIONING_PROFILE` (base64); variable `APPLE_TEAM_ID`                                         |
| Windows  | A code-signing option. The workflow supports Azure Trusted Signing (an Azure subscription and an identity-validated signing account); an OV/EV certificate from a CA is the alternative but needs workflow changes | `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_TRUSTED_SIGNING_ENDPOINT`, `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`, `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME`, `AZURE_TRUSTED_SIGNING_PUBLISHER_NAME` |
| Linux    | Nothing; AppImage and .deb are not signed. `SHA256SUMS` covers them.                                                                                                                                               | none                                                                                                                                                                                                                          |

Until then, users see Gatekeeper and SmartScreen warnings; docs/user/install.md explains how to
open an unsigned build.

## Owner actions outside the repository

- Reserve the `moonfold` package name on npm. The web app checks npm to decide whether a server
  update has been published, and `npx moonfold` needs it; while the name is unclaimed, someone
  else could publish under it.
- Homebrew and winget manifests are prepared in `packaging/` after each release; submitting them
  to the Homebrew and winget repositories is a separate step, done after beta feedback.

## Version scheme

`X.Y.Z` for releases, `X.Y.Z-beta.N` (or `-alpha.N`) for testing builds. No `-rc.N`.
`scripts/update-release-package-versions.ts` writes the version into every package before the
build.
