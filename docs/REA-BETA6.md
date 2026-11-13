# REA gate: Moonfold 1.0.0-beta.6

Date: 2026-11-13. Tools: REA MCP (`inspect_electron_fuses`), `@electron/asar` extraction, and a
host-literal scan of the extracted code. Static analysis only: nothing was executed.

Target: `Moonfold-1.0.0-beta.6-amd64.deb` (SHA-256 `15e5ae71…3af2ab1`) from the release dry run
of commit `e20674a248`, workflow run 43415636966. The Electron executable `moonfold` has SHA-256
`7722b3b9…1c0d87`.

## Observations

- `resources/app-update.yml` points at GitHub Releases of `Mr-Dark-debug/Moonfold`, as before.
- `app.asar` holds 2,727 files, as in 1.0.0-rc.1. The only code change over rc.1 is the default
  relay address `wss://moonfold-anywhere-relay.moonfold.workers.dev`, found in the server bundle
  and the Mobile App settings page. The server connects to it only while the user has Reach from
  anywhere turned on.
- The owner's Cloudflare account name appears nowhere in the package; the relay's subdomain was
  renamed before the build (D-75).
- The other outbound hosts are those rc.1 recorded: GitHub's API, Hacker News and Reddit feeds for
  Orbit, and the dormant Connect pages' `clerk.com` and `t3.chat` strings.
- Electron fuses are unchanged: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments` are on, ASAR integrity and app.asar-only loading are off
  (evidence `ev_fc44912b55bc…`).

## Android 0.3.0-beta.1

Built locally and attached by hand (`app-release.apk`, SHA-256 `002970b4…2c6a6e`), signed with the
same key as 0.1 and 0.2. New: the `REQUEST_INSTALL_PACKAGES` permission, an unexported install
status receiver and a launcher shortcut. It contacts `api.github.com` and GitHub's download host for
updates and the relay the pairing code names. No new library.

## Unknowns and open items

- Fuse hardening is still open from beta 5.
- Only the Linux x64 package was inspected; the other five builds come from the same run.
