# REA gate: Moonfold 0.1.0-beta.5

Date: 2026-11-10. Tools: REA MCP (`inspect_electron_fuses`), `@electron/asar` extraction, and a
host-literal scan of the extracted code. Static analysis only: nothing was executed.

Target: `Moonfold-0.1.0-beta.5-amd64.deb` (SHA-256 `42598745c312…e649a1a`) from the release dry run
of commit `6d00d2dadf`, workflow run 42727325108. This release is the first built on the upstream
sync (D-64), so the scan looks for anything the sync brought in that talks to a service Moonfold
does not own.

## Observations

- Version stamped `0.1.0-beta.5`. `resources/app-update.yml` points at GitHub Releases of
  `Mr-Dark-debug/Moonfold`; no other update source.
- `app.asar` holds 2,717 files (286 MB unpacked). Native addons: `ffi-rs`, `keyring`, `koffi`, `pty`
  and `xa11y`, all Linux x64 builds here.
- No baked-in Clerk, PostHog or Sentry keys. Telemetry code reads `MOONFOLD_POSTHOG_KEY` and
  `MOONFOLD_POSTHOG_HOST` from the environment, so it stays off unless the user sets both.
- The only T3-owned domain is `t3.chat`, inside the hosted Connect account pages chunk
  (`MoonfoldConnectAccountPages`). It is a link the user would have to click, in code that needs a
  hosted sign-in key Moonfold does not ship (D-64). The same chunk is why `clerk` appears about 565
  times. The chunk is dead code and should be removed in a later release.
- Hosts the code reaches only for a feature the user starts, as read from the source: Hugging Face
  (dictation models, a size-checked download), `rdap.org` (domain availability in `/brand`), the
  user's own provider endpoints (Cursor, Codex and ChatGPT, Claude, Gemini, Grok) and the search
  engines offered in the browser pane. The other hosts among the 155 found are documentation or
  specification links inside bundled libraries.
- Two links pointed at T3 Code's repository and were wrong for Moonfold: the "failed to start"
  screen's report link (T3's issue tracker) and the multiple-accounts note (T3's FAQ). Both are
  fixed in this release. Remaining `pingdotgg` links are the About page's upstream credit and the
  dead Connect troubleshooting pages.
- New third-party code from the sync includes `@betteroffice/docx`, `pptx`, `xlsx` (Apache-2.0) and
  `fonts` (Apache-2.0 and OFL-1.1). `vp run licenses:sync` changes nothing, so the shipped notices
  are current.
- Electron fuses of the Linux executable (sentinel complete, evidence `ev_f62f6cfa…`): RunAsNode,
  EnableNodeOptionsEnvironmentVariable, EnableNodeCliInspectArguments and
  GrantFileProtocolExtraPrivileges enabled; EnableCookieEncryption,
  EnableEmbeddedAsarIntegrityValidation and OnlyLoadAppFromAsar disabled. These are Electron's
  defaults: nothing in the repository flips fuses (no `@electron/fuses`), and this release does
  not either. No earlier gate recorded them.

## Inferences and unknowns

- The Windows and macOS installers were not unpacked. Their JavaScript is built from the same
  sources; the native binaries differ.
- No runtime network capture of this build. That the hosted pages stay unreachable without a
  hosted key rests on reading the code (D-64), not on a capture.
- Hardening the fuses (turning off RunAsNode and Inspector arguments, loading only from the asar)
  needs a check that the server sidecar launch does not depend on RunAsNode. Not done here; open.
- Static scan only: strings in the Office preview workers mention `betteroffice.dev`, and no fetch
  to it was found.
