# REA gate: Moonfold 1.0.0-rc.1

Date: 2026-11-12. Tools: REA MCP (`inspect_electron_fuses`), `@electron/asar` extraction, and a
host-literal scan of the extracted code. Static analysis only: nothing was executed.

Target: `Moonfold-1.0.0-rc.1-amd64.deb` (SHA-256 `89185aaa5b22…d0c3ba`, matching `SHA256SUMS`)
from the release dry run of commit `6912e943ac`, workflow run 43183551657.

## Observations

- `resources/app-update.yml` points at GitHub Releases of `Mr-Dark-debug/Moonfold`; no other
  update source.
- `app.asar` holds 2,727 files, ten more than beta 5. The Anywhere protocol
  (`moonfold-anywhere-v1`) and Orbit's tools (`orbit_brief` and the rest) are in the server bundle.
- New outbound hosts, all reached only when the user turns a feature on: `hn.algolia.com` and
  `www.reddit.com` feeds for Orbit's scout, and the relay address the user enters for Reach from
  anywhere. No relay address is built in (`DEFAULT_ANYWHERE_RELAY_URL` is null), so a fresh install
  opens no relay connection.
- No baked-in Clerk, PostHog or Sentry keys. The `clerk.com` and `t3.chat` strings are the same ones
  beta 5 recorded, inside the dormant hosted Connect pages, which need a sign-in key Moonfold does
  not ship.
- Electron fuses are unchanged from beta 5: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable` and
  `EnableNodeCliInspectArguments` are on, ASAR integrity and app.asar-only loading are off
  (evidence `ev_c9bb16b75a3a…`).

## Unknowns and open items

- Fuse hardening is still open from beta 5: the server sidecar's use of `RunAsNode` has to be
  checked before turning it off.
- The dormant Connect pages are still bundled.
- Only the Linux x64 package was inspected; the other five builds come from the same commit and
  workflow run.
- The published release (run 43188871249, tag on `b41d1eaa98`) was built again, so its `.deb`
  hashes differ (`11b203d2…29cf1`). That commit adds only docs and the Android version over
  `6912e943ac`; all 26 published assets match the published `SHA256SUMS`.
