# QA report (Phase 6: hardening)

Date: 2026-10-20. Machine: Windows 11 Home x64 laptop, Node 24.14.1, Electron 44.4.5. Plan:
docs/plans/phase-6.md. REA gate: docs/REA-PHASE6.md. Decisions: DECISIONS D-39 to D-44.

Severity: **high** means a user's data, credentials or machine are at risk, or a feature cannot be
used. **Medium** means a real weakness with a narrower path or a budget miss. **Low** means
defence in depth or polish.

## Summary

| Area                       | Result                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| Electron security          | 2 high and 3 medium found by the reviewer, 1 high (S-15) in Phase 8; all fixed           |
| Provider-login rules (6/7) | Usage hubs removed; Claude token read made opt-in; no T3 or analytics hosts in the build |
| Dependencies               | No critical; 2 high and 2 moderate left, none in shipped code (below)                    |
| Secret scan of logs        | No credentials found in real logs                                                        |
| Accessibility              | 4 medium and 10 low found; mediums and 9 lows fixed, 1 low accepted                      |
| Crash recovery             | Recovery suites pass; the live app recovered from forced kills                           |
| Performance                | Idle and scrolling budgets met; cold start to a usable window is **not** met (4.3 s)     |

Open items rated medium or higher: **one**, the cold-start budget (P-1). It is the only item that
does not meet the Phase 6 gate; see "Open".

## Findings

### Security (reviewer subagent, then fixes)

| ID   | Severity | Finding                                                                                                                                                       | Status   | Fix                                                                                                                                     |
| ---- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S-1  | High     | Desktop IPC handlers answered any frame, including preview webviews and embedded pages                                                                        | Fixed    | Every handler checks the sender frame is `moonfold://app/` (or the dev scheme); others are refused (d8ce2087f)                          |
| S-2  | High     | Usage hubs pooled provider logins behind a third-party proxy (CLAUDE.md rule 7)                                                                               | Fixed    | Integration removed; existing hub entries can only be removed (6e6d1dca7, D-39)                                                         |
| S-3  | Medium   | Claude banked-reset credits read the stored Claude login without the user asking                                                                              | Fixed    | Opt-in switch, off by default (70cc2f542, D-40)                                                                                         |
| S-4  | Medium   | App CSP allowed `unsafe-inline` scripts and T3's hosted sign-in origin                                                                                        | Fixed    | Inline scripts allowed by sha256 hash only; sign-in origins only when a self-hosted Clerk is configured (c6d5bef6f, D-41)               |
| S-5  | Medium   | `.env.example` carried T3's hosted sign-in keys                                                                                                               | Fixed    | Blanked, with self-host wording (c6d5bef6f)                                                                                             |
| S-15 | High     | New threads, environments without a saved default and new scheduled tasks started in Full access (inherited default), against CLAUDE.md's safest-default rule | Fixed    | Default is Supervised (`approval-required`); found while recording the Phase 8 demos (c9435a927, D-49)                                  |
| S-6  | Low      | Session cookies lacked `Secure` behind HTTPS                                                                                                                  | Fixed    | `Secure` when the request arrived over HTTPS or `x-forwarded-proto: https` (670e3e470)                                                  |
| S-7  | Low      | App session granted every permission request                                                                                                                  | Fixed    | Allowlist: clipboard, display capture, fullscreen, notifications (670e3e470)                                                            |
| S-8  | Low      | Webview attach did not pin the preload or the source scheme                                                                                                   | Fixed    | Preload path pinned; only http(s) and `about:blank` sources (670e3e470)                                                                 |
| S-9  | Low      | The pairing URL went into structured log annotations                                                                                                          | Fixed    | Printed to the console only (670e3e470)                                                                                                 |
| S-10 | Low      | Docs implied Moonfold Connect works out of the box                                                                                                            | Fixed    | Docs say it needs a self-hosted relay; release builds ship without one (128d45ddf)                                                      |
| S-11 | Low      | Pairing has no per-client rate limit                                                                                                                          | Accepted | Codes carry 60 bits and expire after 5 minutes, and the server binds to 127.0.0.1 unless the user exposes it; guessing is not practical |
| S-12 | Low      | Preview webviews can open external protocols the OS handles                                                                                                   | Accepted | Electron asks the OS, which prompts; the app window itself denies new windows and off-origin navigation                                 |
| S-13 | Low      | Electron fuses are not flipped                                                                                                                                | Accepted | `RunAsNode` is how the desktop starts the bundled server; revisit in Phase 7 with a separate server binary                              |
| S-14 | Low      | Log redaction is per call site, not one layer                                                                                                                 | Accepted | The scan below found no leaks; a central layer is a follow-up                                                                           |

Verified after the fixes: the built desktop's main process creates 7 windows, all with
`contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` (REA-PHASE6). The live app's
renderer IPC calls succeed under the sender check, so the check does not break the app.

### Remote access threat model

- **Exposure.** The server listens on 127.0.0.1 by default (observed: `Listening on
  http://127.0.0.1:<port>`). Other devices reach it only when the user shares it over Tailscale
  (`--share`, which serves HTTPS on the tailnet) or an SSH tunnel. Moonfold Connect needs a relay
  the user hosts; release builds have none.
- **Authentication.** A new browser pairs with a one-time code (60 bits, 5-minute lifetime) or a
  startup URL. Pairing creates a session cookie (`HttpOnly`, `SameSite=Lax`, `Secure` over HTTPS).
  The desktop uses a bearer token passed over its private IPC, never a URL.
- **Authorization.** RPC methods that change state are guarded by scopes
  (`CLIENT_GUARDED_RPC_SCOPES`), checked on the server for the destination environment.
  Ordinary pairing tokens carry standard scopes; only the startup URL carries admin scopes.
- **Secrets.** Tokens and pairing URLs are kept out of structured logs (S-9). Handoff briefs and
  history sent to another provider pass through the secret scanner, and the user sees the brief
  before it is sent.
- **Residual risk.** Anyone the user gives a pairing URL to gets a session until it is revoked in
  Settings → Connections. That is the intended trust model.

### Rules 6 and 7 (hosted services, provider logins)

- Bundle scan of `apps/desktop/dist-electron`, `apps/server/dist` and `apps/web/dist`: no T3
  domains, no PostHog host, no analytics or crash-report hosts. The only Clerk strings are the
  Clerk library's own error messages.
- Telemetry stays off unless the user configures their own receiver. The welcome wizard said
  otherwise; that text was wrong and is fixed (422096e2b).

### Dependencies (`vp pm audit -- --prod`, after fixes)

Fixed by overrides or bumps: seroval, @modelcontextprotocol/sdk, proxy-addr, shell-quote, xml2js,
source-map-js, valibot (a97142b53), sharp (a5fd04a7f). No critical advisories remain.

| Package    | Severity | Path                                            | Why it stays                                                                                     |
| ---------- | -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| node-forge | High     | `infra/relay` deploy tooling (alchemy → expo)   | Not part of the app or server; the fixed version is not published                                |
| braces     | High     | `@legendapp/list` → react-native → metro (peer) | Build tooling of an unused peer; not in any bundle; the fixed version is not published           |
| uuid       | Moderate | `infra/relay` deploy tooling                    | Not shipped                                                                                      |
| sprintf-js | Moderate | mammoth → argparse                              | argparse is mammoth's CLI; the web bundle does not include it (no `ArgumentParser` in the build) |
| katex      | Low      | mermaid → katex 0.16                            | Mermaid requires 0.16; the advisory needs an existing prototype pollution first                  |

### Secret-leak scan

`node scripts/scan-logs-for-secrets.ts <logs-dir>` runs the handoff brief's scanner over every log
file. On this machine's development logs it found no credentials; authorization headers and
passwords already appear as `[REDACTED]`. The scanner's false positive on plain numbers (token
counts) was fixed first (86915c3fc).

### Accessibility (reviewer subagent over the 22 UI files Moonfold added)

| ID   | Severity | Finding                                                          | Status   |
| ---- | -------- | ---------------------------------------------------------------- | -------- |
| A-1  | Medium   | Welcome wizard "select all" checkboxes had no accessible name    | Fixed    |
| A-2  | Medium   | Side-question answers were not announced                         | Fixed    |
| A-3  | Medium   | Small error text used a red that fails AA in the light theme     | Fixed    |
| A-4  | Medium   | Reordering the handoff fallback list dropped keyboard focus      | Fixed    |
| A-5  | Low      | Computer-use log outcomes shown only by colour                   | Fixed    |
| A-6  | Low      | Import and Office preview errors not announced                   | Fixed    |
| A-7  | Low      | Setup terminal status not announced                              | Fixed    |
| A-8  | Low      | Quick-window shortcut errors not announced; modifier hint hidden | Fixed    |
| A-9  | Low      | Fallback, hub, plugin and memory buttons had ambiguous names     | Fixed    |
| A-10 | Low      | "Show all" artifacts toggle lacked `aria-expanded`               | Fixed    |
| A-11 | Low      | Wizard chevrons ignored reduced motion                           | Fixed    |
| A-12 | Low      | No app-wide reduced-motion rule; each animation opts in          | Accepted |

Checked and fine: every dialog has a title, icon-only buttons have names, no focus outline is
removed without a replacement.

### Crash recovery

| Case                     | Evidence                                                                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider process dies    | `ProviderRuntimeRecoveryService` and its regression and performance suites: pass                                                                                                                  |
| App killed mid-turn      | `OrchestratorReplayRecovery.integration`, `ProjectionRecovery`: pass. Live: the desktop was force-killed (`taskkill /F`) four times; each restart logged a completed recovery and opened normally |
| Disk full / failed write | `FoundationPersistence`: a failed write rolls back events, projections, receipts and effects together (44/44 pass)                                                                                |
| Offline                  | Provider network errors end the turn as an error or a usage limit (HANDOFF-SIGNALS.md); the client reconnects to the server on its own                                                            |

Recovery suites: 5 files, 32 passed, 1 skipped. Persistence: 44 passed.

### Performance (measured)

| Budget                        | Measured                                                                                                                                                                | Met                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| Idle CPU near zero            | Server idle 60 s: 0.26 % of one core (`scripts/measure-server-idle.ts`)                                                                                                 | Yes                     |
| Idle RAM reasonable           | Server RSS 232 MB                                                                                                                                                       | Yes                     |
| 60 fps on a 5,000-item thread | 5,220 items loaded (153,000 px). Wheel-speed scroll (40 px/frame): 60.6 to 63.3 fps average, p50 13.3 ms, p95 13.7 to 26.7 ms. Fast flings (120 px/frame): 45 to 48 fps | Yes on average; see P-2 |
| Cold start under 3 s          | Desktop, warm launch: window with splash 0.94 s; backend ready and app window 4.29 s; app UI talking to the server 4.70 s                                               | **No**                  |

Method: desktop numbers come from the app's own trace spans (`desktop.trace.ndjson`) of a warm
launch of the built app on a scratch home, timed from process start. Scrolling ran in a desktop
window the test launched, driven over the DevTools protocol with `requestAnimationFrame` frame
timing on a 75 Hz display; the thread was a scratch copy of real data grown to 5,220 items.

Changes this phase: the splash now shows for every local start, not only WSL (was a blank window
until about 3.6 s); the backend no longer spawns PowerShell to re-read the Windows environment the
desktop already installed (about 0.4 s); the two Codex CLI probes run in parallel (about 0.16 s).

## Open

| ID  | Severity | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-1 | Medium   | Cold start to a usable window is 4.3 s against a 3 s budget. The splash appears in under 1 s. Where the time goes (warm, this laptop): 0.44 s desktop startup (0.39 s of it reading the Windows environment), 1.2 s evaluating the 13.9 MB server bundle (1.0 s with the compile cache packaged builds use), 1.3 s building server services (Codex probes, device host checks), then the window. Meeting 3 s needs the server to load providers and device support after it starts listening. Packaged Windows build (Phase 7 dry run, compile cache on): splash 0.9 s, usable window 4.0 to 5.1 s on warm launches, 5.6 s on the first launch after install. |
| P-2 | Low      | Scrolling stays near 60 fps on average, but frames that mount a large markdown message take 80 to 120 ms (p99). Most of it is markdown parsing and layout of the new row; caching parsed markdown per message would remove the parse on revisits.                                                                                                                                                                                                                                                                                                                                                                                                             |
