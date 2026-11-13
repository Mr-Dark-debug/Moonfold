# REA gate: Moonfold 1.0.0-beta.7

Date: 2026-11-13. Tools: REA MCP (`inspect_electron_fuses`) and a live install test. No new
dependency or bundled binary since beta 6 (docs/REA-BETA6.md); the changes are the NSIS installer
script, update-track logic and seven web routes.

Target: `Moonfold-1.0.0-beta.7-x64.exe` from the release dry run of commit `e8b7178f7f`, workflow
run 43425008183, installed per-user on Windows 11. Installed `Moonfold (Beta).exe` SHA-256
`dfd6c4ec…bd8d12d`.

## Observations

- Install test (D-77): with exactly one process running from the install folder, the beta 6
  installer left it running (electron-builder's single-match `.Count` bug). The beta 7 installer
  closed it, wrote the new app, recorded `1.0.0-beta.7`, and the Start-menu shortcut resolved.
- Electron fuses on Windows match the Linux build of beta 6: `RunAsNode`,
  `EnableNodeOptionsEnvironmentVariable` and `EnableNodeCliInspectArguments` on; ASAR integrity
  not enforced; app.asar-only loading off (evidence `ev_8e6c591dd394…`).

## Unknowns and open items

- The published build adds the route fix and documents on top of the inspected commit; it was not
  scanned again.
- Fuse hardening is still open from beta 5.
