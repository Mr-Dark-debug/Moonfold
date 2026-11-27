# REA gate: Moonfold 1.0.0-beta.8

Date: 2026-11-27. Tools: REA MCP (`inspect_electron_fuses`), `@electron/asar` to unpack the app. No
new dependency or bundled binary since beta 7 (docs/REA-BETA7.md); the change is the chat session
importer (server, contracts, web dialog).

Target: the release dry run of commit `ba76c95eed`, workflow run 46039030163.
`Moonfold-1.0.0-beta.8-amd64.deb` SHA-256 `fe018231…f020981`; Electron binary `moonfold` SHA-256
`7722b3b9…1c0d87`. REA cannot unpack the Windows NSIS installer, so the Linux package stood in;
`Moonfold-1.0.0-beta.8-x64.exe` SHA-256 is `133dec28…e75bdb`.

## Observations

- The packaged server registers `agentSessions.lookup` and `agentSessions.importSession` next to
  the existing `list`, `scan` and `import` methods, and the bundled client carries the import
  dialog. The importer opens provider SQLite files read-only and only reads transcripts; it writes
  only into Moonfold's own state (and, for Antigravity, a copy of the conversation database in
  Moonfold's provider profile).
- Parsers checked against real local sessions before the release: Codex (223 messages, 1,432 tool
  calls, 345 reasoning items, cut at 2,000 items with 1,318 reported as omitted), Claude Code
  (7 messages, 15 tool calls) and Antigravity (444 messages, 646 tool calls).
- Electron fuses are unchanged from beta 7: `RunAsNode`, `EnableNodeOptionsEnvironmentVariable`
  and `EnableNodeCliInspectArguments` on; ASAR integrity not enforced; app.asar-only loading off
  (evidence `ev_6719dd162d32…`).

## Unknowns and open items

- Pi sessions were not imported on this machine: no Pi history exists here. Unit tests cover the
  Pi parser.
- Fuse hardening is still open from beta 5.
