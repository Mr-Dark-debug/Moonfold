# Progress

## Road to 1.0 (started 2026-11-10)

Branch `stable-1`. Plans written, nothing built yet: docs/plans/stable-1.0.md (order and gate),
project-knowledge-ci-fixer.md, mascot.md, anywhere.md, orbit.md. Decisions D-67 to D-71.
`feat/home-backgrounds` is in `main`; no other Moonfold branch exists.

Research behind the plans (public sources, summarized in each plan): how Jules does memory and CI
fixing, how always-on agents from the large labs and the self-hosted ones run and what stops them,
reported failures of unattended agents, what each feedback and posting channel allows, and every
way to reach a computer behind address translation without an account.

Waiting for the owner: approval of the living-mark plan and its three choices; a Cloudflare
account and one deploy for the default Anywhere relay; the right to ship the two landscape
pictures (D-65); Orbit's name and default level. Provider runs wait for Codex (19 November) or a
Claude Code sign-in.

Built so far (feature 1, D-68):

- CI fixer: a thread that creates a pull request watches it by itself; failed checks wake the
  agent with a try number and fixed rules; after the project's limit (Settings → Source Control →
  Fix failing checks, three by default) the watch ends and the agent stops and asks.
- Project knowledge: memories have a kind (preference or setup fact); agents can note a
  correction, which waits as a suggestion by default (Settings → Memories → Learn from
  corrections); credential-shaped text is refused; Cursor, OpenCode, Muse Code and ACP agents now
  receive memories. Migration 85.

Verified on Windows: typecheck in contracts, server, web and the provider packages; the watch,
link, memory store, migration, budget and MCP server tests; `vp check`, knip and the brand check.
Not verified: a live pull request with a failing check, and a live correction with a real
provider. No eval was run for the changed `remember` description (no provider access).

Feature 2, the living mark (D-67), built 2026-11-12:

- Geometry in `scripts/lib/brand-mark.ts` (`livingMarkData`), generated into
  `packages/shared/src/livingMark.generated.json` and still SVGs in `assets/brand/living/`; the
  icon check covers both.
- `LivingMark` with five states and a still pose each; the star's lap is two cancelling rotations,
  transforms and opacity only, paused off screen. `CouncilGlyph` (six seats) and `SkillKindGlyph`.
- Used in: the timeline's Thinking row (working, waiting while an approval is pending), the slash
  menu's skill badges, plugin skills in Settings, the welcome wizard, the empty thread and About.
- Review rounds: `brand_review_round` keeps each reviewer on a seat and writes
  `reviews/index.md` with the glyphs; Cassandre's instructions use it.
- QA: docs/QA-MASCOT.md, captures in both themes and with reduced motion; a Chromium test proves
  the lap follows the ring without turning the star.

Not checked: the real app by eye, a performance trace of a long working state.

Feature 3, Anywhere (D-69), built 2026-11-12:

- Protocol and relay core in `packages/shared/src/anywhereRelay.ts`; `moonfold relay` (Node) and
  `infra/anywhere-relay` (Workers, hibernating Durable Objects) run it.
- The server keeps a relay connection while **Reach from anywhere** is on (Settings → Mobile App,
  relay address there) and pipes each phone stream into its own HTTPS listener.
- The Android app listens on `127.0.0.1` at the computer's port and sends each connection through
  the relay (OkHttp); the pairing code carries `relay` and `room`.
- Verified: protocol tests with real Ed25519 keys; a real-socket test carrying a TLS session
  through the Node relay, where the phone sees the computer's own certificate; Kotlin tests (10);
  debug APK builds; `moonfold relay` starts and answers `/health`.
- Not verified: the Workers relay (needs a Cloudflare account to deploy); a phone or emulator on
  another network end to end. No default relay ships until the owner deploys one.

Feature 4, Orbit (D-70), built 2026-11-12:

- Server: `apps/server/src/orbit/` (service, crew prompts, channel readers), migration 86, seven
  role-checked MCP tools, five RPCs. The crew is scheduled tasks Orbit installs and switches.
- Screen: **Orbit** in the sidebar: mission prompt, crew rail with living-mark states, autonomy
  level, channels, run cap, inbox, backlog and activity log. User guide: docs/user/orbit.md.
- Verified: service tests (crew per level, stop switch, daily budget, role lookup, owner requests
  first, quiet runs filed), feed parser tests, screen logic tests, typecheck and lint.
- Not verified: a real crew run against a provider; the screen in a running client.

Next: the 1.0 release gate (docs/plans/stable-1.0.md).

## Beta 5 (2026-11-10)

Done: v0.1.0-beta.5 is published and Latest (27 assets, tag on `b9e5d09da6`). It carries home screen
backgrounds (D-65), the upstream sync (D-64) and Cassandre (D-63). Notes:
docs/releases/v0.1.0-beta.5.md. REA gate: docs/REA-BETA5.md.

The release dry run found what the sync had broken in the pipeline, none of it visible in CI:

- The CLI executable step still forced Node 26.8.2, while `package.json` now requires 26.12.1. The
  pin is gone; `setup-vp` installs the right Node.
- Windows x64 packs 82 files against upstream's budget of 80 (arm64 packs 80). The budget is 84
  (D-66) and the error now says where the files are.
- `check-brand` now allows `REA-BETA*.md` records, like `REA-PHASE*.md`.

Product fixes on the way: the ASCII Moonfold emblem was oversized and clipped (found by rendering the
real component in Chromium; the static mock had hidden it), and the crash-report link and the
multiple-accounts note pointed at T3 Code's repository instead of Moonfold's. Someone else merged
the branch into `main` while this was in progress; the work was rebuilt on top of `origin/main`.

Verified (real output, Windows 11 and CI):

- Upgrade: this release's migrations 63 to 84 applied to a snapshot of the real beta 4 database
  (`vp run migrate-dev-db`, exit 0), and the server booted on the copy reporting
  `databaseMigration` 84 with no errors in its log. The copy is pruned to 5 projects and 10 threads
  each, and no client was connected.
- CI green on `main` at the tagged commit. The dry run and the tagged run built all six targets and
  ran checksums, SBOM and publish. All 26 files verify against `SHA256SUMS`, the public Windows x64
  installer matches its published SHA-256, and `latest.yml` serves 0.1.0-beta.5.
- Home backgrounds: three scenes, both styles and both themes rendered from the real component in
  Chromium; `ChatView.browser.test.tsx` passes.
- Local gates: `vp check` 0 errors, `knip:check`, `check-brand`, icon check, typecheck in contracts,
  web, desktop and scripts.

Not verified / open:

- No click-through of a running client: Settings rows and dropdowns, the home screen inside the real
  layout, phones and short windows. No installer was launched; only checksums were checked.
- `/brand` and question cards have not run against a live provider (Codex is limited until 19
  November, Claude Code is not signed in here). Evals for the new tool text have not been run.
- Moonfold for Android beta 1 was not re-tested against this server. No new APK.
- Electron fuses are at their defaults (REA-BETA5). Hardening them needs a check that the server
  sidecar does not rely on RunAsNode.
- The hosted Connect account pages are still bundled as dead code.
- The owner still has to confirm the right to ship the two landscape pictures (D-65).
- On this Windows machine 8 tests in `scripts/build-desktop-artifact.test.ts` (GNU tar reads `C:\`
  as a host) and 1 in `DesktopClientSettings.test.ts` (path separator) fail; they fail identically
  without these changes and pass on Linux CI.

Next: click through the published build on web and desktop, then decide whether the default stays
Classic and whether to remove the Connect pages.

## Upstream sync and Cassandre (2026-11-09)

Done:

- Merged upstream T3 Code `202d5b561` (4,004 commits) through a rebranded base (D-64), which brings
  upstream's UI overhaul with it (D-62). Kept out: the Expo phone app, the marketing site, the hosted
  CI cache and login pooling; hosted relay/Connect/guest links stay off without a hosted key.
- Cassandre brand kits (D-63, docs/user/brand-kits.md): `/brand <prompt>` runs a built-in prompt
  profile; `BrandKitService` and eight `brand_*` MCP tools; `moonfold_ask_user` question cards
  with picture options, for every provider with Moonfold's MCP tools.

Decisions: D-62 rewritten (no toggle; upstream made the new design the only one), D-63, D-64.
`agentContextBudget.json` raised to the measured Moonfold values; CI flags budget growth.

Verified on Windows before the merge: typecheck in every package, `vp check` 0 errors,
`knip:check`, `check-brand` clean. Per-package tests: client-runtime 1762 passed, web 4874 with 2
failures (fixed in `88e91a19d`), contracts and the provider, ssh, tailscale and source-control
packages passing. Upstream tests that assumed its repo URL, a `full-access` default and the
mobile voice docs were aligned with Moonfold. The first main CI run after the merge still failed
16 tests that the Windows run had hidden or that I had misread as Windows-only. All were fixed in
`f222e1632`, along with migration file names, Rust formatting and the web job's missing Chromium.
The rest of the Windows failures are environment-only: POSIX paths and separators, `/tmp`
fixtures, Linux compositors, macOS login shells, case-insensitive files and symlinks.

Open problems: no live run of `/brand` with a real provider yet, and no click-through of the
question card in a running client. Evals for the new tool descriptions have not been run.
Moonfold-only screens still need the scored review loop (docs/plans/ui-refresh.md). Hosted
Connect account pages are dead code here and should be removed. Codex is limited until 19 November.

Next: a real `/brand` run with Claude Code in a scratch project, then the UI review loop.

## Home screen backgrounds (2026-11-09, merged 2026-11-10)

Done: Settings → Appearance → Home screen picks a **Background** (Classic, Moonfold, Golden hour,
Purple wind) and a **Background style** (ASCII text or Image). Two per-device client settings,
default Classic and ASCII. The artwork shows only behind the new thread screen and loads only when
chosen. Decision: D-65. The branch predated the upstream sync, so its settings rows were re-applied
in upstream's new `AppearanceSettingsPanel.tsx`.

Open problems: not yet looked at in a running client (web, desktop, phone, short windows). The
owner still has to confirm the right to ship the two landscape pictures (D-65) before a stable
release includes them.

## Beta 4 (2026-11-02)

Done: Moonfold for Android beta 1 (`apps/mobile`, native Kotlin, our own code, nothing from the
`opencode-mobile` zip), pinned HTTPS listener and QR pairing (D-57, D-58), content exclusions
(D-59), token limit per run (D-60), dark theme fix for Chromium up to 133. Pull request → thread
already existed. Gap-analysis items Parallel Drafts, side question, memory, review, deep links and
OTLP were already shipped.

Decisions: connectors stay out of this release, for curated MCP entries later. iOS is out: it cannot
be built here. The release key is in `~/.moonfold-release`, outside the repository (D-61). Losing it
means users must reinstall the app.

Verified: `docs/QA-BETA4.md` (emulator, real production server) and `docs/REA-BETA4.md`.

Open problems: live camera decode, a real phone on real Wi-Fi, Tailscale, a full agent turn on the
phone and live runs of the two new limits could not be verified here (Codex limited until 19
November, Claude Code not signed in on this machine). No iOS app. No notifications while the app is
closed.

Published: v0.1.0-beta.4 is Latest, with `Moonfold-Android-0.1.0-beta.1.apk` attached by hand (SHA-256
`1c8ae1a3c7e9e1db964db9a838055e4722a3d248909bac58ceaa9650328a67a6`). Main CI needed one fix first:
two server tests failed on date and timing, unrelated to this release. `AcpRegistryAdapterV2.test.ts`
still fails its real-child-process case on Windows only, because its fixture has no win32
distribution; CI runs on Linux.

Next: try the APK on a real phone, then decide on connectors.

## Beta 3 (2026-10-28)

Plan: docs/plans/beta-3.md. Decisions: D-53 to D-56. QA: docs/QA-BETA3.md. REA gate:
docs/REA-BETA3.md.

### Done

- Repository: the merged `brand-and-launch` branch deleted locally and on GitHub; work on `beta-3`.
- DeepSeek Harness in the agent search through a built-in supplement to the ACP Registry catalog
  (pinned `npx` package, generic ACP adapter, no per-agent branch). Exhausted-balance and quota
  wording now ends ACP runs as usage limits.
- Prompt profiles: built-ins plus custom profiles in settings.json, environment or project
  default, per-thread override from the thread menu; delivered through each adapter's existing
  instruction channel (Codex additionalContext, Claude system append plus a note when it changes
  mid-session, runtime block for ACP agents, Cursor, Muse and OpenCode, a note for Pi).
- Scheduled send: right-click or long-press Send, `/timed` with a small time parser, "Schedule a
  message for reset" on the usage-limit notice, a waiting-message banner with Send now and Cancel.
  One-off scheduled tasks bound to the thread.
- Local models for Pi: Ollama and LM Studio detected on loopback when the instance's Local models
  switch is on; a Moonfold-owned Pi extension registers them for the process, so `~/.pi` is never
  edited.
- Website: docs and blog pages (previous change) plus the new guides and a beta 3 post. Main CI
  had failed on that change (brand check over the generated pages, and one timing test); the
  brand-check allowlist now covers the generated pages.

### Verification (real output, Windows 11, 2026-10-28)

- Live (QA-BETA3): prompt profile marker returned by Claude Haiku 5.5 after the mid-session fix;
  a message scheduled with Claude fired on time from a Codex thread at its real limit and was
  answered after an automatic handoff; `/timed` and right-click open the dialog; Pi 1.4.0 listed
  and ran a local Ollama model; DeepSeek Harness 0.2.1-rc.2 installed from the agent search and
  answered through local Ollama.
- Typechecks clean: contracts, provider-core, provider-pi, provider-acp, provider-acp-registry,
  provider-cursor, provider-muse, provider-opencode, client-runtime, server, web.
- Tests: contracts 676/676, client-runtime 2088/2088, provider-pi 143/143, Claude adapter 264/264,
  web touched files (settings search 64, thread menu 23, composer logic and primary actions 108,
  scheduled send 10) all pass. provider-core 8 and provider-acp 3 failures are Windows-only cases
  in files not touched (POSIX install paths, symlinks, shell); acp-registry 18 Windows failures
  identical before and after (checked with a stash).
- `vp check` 0 errors; `vp fmt --check` clean; `vp run knip:check` clean; brand and icon checks
  clean.

### Not verified / open

- Prompt profiles live on Codex (account limited until 19 November), Cursor, OpenCode, Muse, Grok
  and Antigravity: tests only.
- DeepSeek Harness with a DeepSeek account and its real limit messages; LM Studio; long-press on a
  touch device; macOS and Linux.
- With the default `DSH_HOME`, Moonfold's first probe of DeepSeek Harness writes an `acp` profile
  into `~/.dsh` (dsh's own behaviour). Documented, not changed.
- Out of scope for beta 3, recorded in the plan: native Ollama agent, Pieces, VS Code extension,
  `moonfold.json` lock-down, strict local-only mode, OAuth connectors, hosted plugin store.

### Release

- v0.1.0-beta.3 published 2026-10-28 (27 assets, Latest) after main CI passed. The first tag was
  cancelled before publishing: beta installs never saw updates (electron-updater skips -beta.N
  releases when its channel is set to "latest"); fixed, and electron-updater 6.8.9 against the live
  feed now resolves 0.1.0-beta.3 for a beta.1 install. Beta 1 and 2 need one manual install.
- Also fixed on the way: main CI was red from the website brand check, a test mock, two Registry
  tests and newer Git wording in storage cleanup.

### Next step

After beta 3: the cold-start budget (ROADMAP),
and prompt profiles live on Codex once its limit resets.

## Brand and launch follow-ups (2026-10-26)

Decisions: D-51, D-52.

### Done

- New ringed-moon mark from one parametric model (`scripts/lib/brand-mark.ts`): every icon,
  favicon, social preview, docs-site logo and `MoonfoldMark` regenerated from it.
- CLI installers draw the mark in half-block colour (plain blocks under `NO_COLOR`); the leftover
  upstream command name in `install.sh` messages is gone.
- Betas publish as the latest release; v0.1.0-beta.1 edited to match, so GitHub lists it.
- Removed the stale `production` environment left by the upstream relay workflow's first run.
- Main CI was red after outside PR #17 (formatting) and the website import (app lint and brand
  check ran over `moonfold-website/`); fixed and merged.
- 40 s launch video (`docs/assets/moonfold-launch.mp4`): motion graphics rendered frame by frame
  in headless Edge from the real app recording, with a synthesized soundtrack.
- Repository topics added. Launch kit drafted in `.plans/launch-kit.md` (not posted).
- v0.1.0-beta.2 published (27 assets, marked Latest). Main CI green after pinning node-pty to the
  patched 1.2.0-beta.15 (newer betas broke the release smoke check). `install.ps1` from main
  installed it into a scratch folder: `moonfold --version` printed `moonfold v0.1.0-beta.2`, and
  the banner drew in a real PowerShell terminal. `latest.yml` and GitHub's latest release both
  point at beta.2. Homebrew and winget manifests regenerated (not submitted).

### Not verified / open

- The in-app update from beta.1 to beta.2 was not run: the owner's own beta.1 install is on this
  machine and a second install would replace its registration. Only the feed was checked.
- No new dependency or third-party artifact since beta.1, so the REA gate was not re-run.
- Vercel builds of `moonfold-website` fail because the project builds the repository root (log:
  `vp: command not found`). The fix is the project's Root Directory = `moonfold-website`, an
  owner account setting.
- Owner actions: re-upload `assets/brand/social-preview.png` (new mark) in Settings → Social
  preview; post the launch kit; submit the form-only directories.

## Phase 8: launch assets (2026-10-20)

Plan: docs/plans/phase-8.md. Decisions: D-49, D-50.

### Done

- README: handoff demo GIF at the top, value props, install one-liners, a handoff diagram, a
  dated comparison, FAQ, and two more demos (browser pane plus scheduled tasks; plugins plus
  memories). All recorded from the app over CDP in a scratch home and a throwaway repository;
  hostnames and local paths blurred frame by frame.
- 1280x640 social preview (`assets/brand/social-preview.png`, `vp run brand:social`).
- Docs site from `docs/user` (`vp run docs:site`, deployed by `pages.yml`).
- CHANGELOG, ROADMAP, Homebrew cask and winget manifests from the published checksums.
- Fixes found while recording: new threads and scheduled tasks start Supervised (they started in
  Full access, QA-REPORT S-15); after a handoff the composer follows the thread's new provider.
- Live: a task handed from Codex to Claude was finished by Claude with all tests passing, which
  closes Phase 4's open live item (QA-PHASE4 follow-up).

### Verification (real output, 2026-10-20)

- Tests: docs site 3/3 (every in-page anchor on the site resolves), package manifests 4/4,
  ChatView logic 131/131, contracts settings and composer draft 313/313; the server test files
  that use `runtimeMode` (90) fail exactly the same baseline Windows cases before and after the
  default change. Typechecks clean; lint clean in changed files.

### Not verified / open

- The BUILD-PLAN gate's "a stranger goes from README to a first task in five minutes" needs a
  person outside this session.
- Owner actions: upload `assets/brand/social-preview.png` in Settings → Social preview; reserve
  `moonfold` on npm; signing certificates.

## Phase 7: packaging and beta release (2026-10-20)

Plan: docs/plans/phase-7.md. Process: docs/operations/release.md. REA gate: docs/REA-PHASE7.md.
Decisions: DECISIONS D-45 to D-48. Notes: docs/releases/v0.1.0-beta.1.md. CHANGELOG.md.

### Done

- `release.yml` and `release-desktop.yml`: macOS arm64/x64 (dmg), Windows x64/arm64 (NSIS), Linux
  x64/arm64 (AppImage and .deb) on GitHub-hosted runners; CLI archives for the install scripts
  (none for Intel macOS); merged update manifests, CycloneDX SBOM, `SHA256SUMS`; prerelease for
  `-beta.N`; signing only when its secrets exist; `release-dry-run/<version>` branches build
  without publishing.
- Beta installs accept GitHub prereleases; the install scripts' default channel includes betas;
  server updates wait for the GitHub release instead of npm.
- Signing requirements and first-run steps for unsigned builds; README install section.
- Homebrew cask and winget manifests generated from a release's `SHA256SUMS`
  (`vp run release:manifests`), not submitted.

### Verification (real output, 2026-10-20)

- Dry run `0.1.0-beta.1` on GitHub Actions: all six targets, the CLI smoke tests and the assemble
  job passed (run 39444188954); 26 release files listed.
- Windows 11 x64: the installer installed silently, launched on a scratch home, reached its
  backend, and uninstalled cleanly. `install.ps1` installed the CLI archive from a local mirror
  and `moonfold --version` printed `moonfold v0.1.0-beta.1`. Packaged warm launch: splash 0.9 s,
  usable window 4.0 to 5.1 s.
- REA: Electron fuses, app.asar, update feed config and hosts of the Linux build; Authenticode
  status of the Windows installer (unsigned).
- Tests: package manifests 4/4, update channels, release-published check and update-everything
  hooks 287/287, registry tests 7 passed (2 skip on Windows; CI runs them). Typechecks clean;
  knip clean; `vp check` errors only in the untracked `moonfold-website/`.

### Not verified / open

- The BUILD-PLAN gate's clean-machine runs on macOS and Linux, a provider task and handoff on an
  installed build (both provider accounts are at their limits until November), and an update to
  a newer build (needs a second release).
- Owner actions: reserve the `moonfold` name on npm; Apple Developer and Windows signing for
  signed builds; submit the Homebrew and winget manifests after beta feedback.
- QA-REPORT P-1: cold start to a usable window is still about 4 s.

- Published: [v0.1.0-beta.1](https://github.com/Mr-Dark-debug/Moonfold/releases/tag/v0.1.0-beta.1)
  (run 39457838858), a prerelease with 27 files: installers for all six targets, CLI archives,
  update manifests, SBOM (2,654 components) and `SHA256SUMS`. `install.ps1` installed it from
  GitHub with no version pinned. The first tag was withdrawn before publishing to include the
  Supervised default (D-49).

### Next step

Phase 8 (launch assets).

## Phase 6: hardening (complete with one open item, 2026-10-20)

Plan: docs/plans/phase-6.md. Report: docs/QA-REPORT.md. REA gate: docs/REA-PHASE6.md. Decisions:
DECISIONS D-39 to D-44.

### Done

- Security review by a reviewer subagent; both highs and all three mediums fixed: IPC answers only
  the app's frame, usage hubs removed (rule 7), the Claude token read is opt-in, the CSP uses
  script hashes and no T3 sign-in origin, T3 keys gone from `.env.example`. Lows: Secure cookies
  over HTTPS, a permission allowlist, a pinned webview preload, no pairing URL in logs.
- Dependency audit: patched overrides and sharp 0.35.5; no critical advisories; what remains is
  in relay deploy tooling or unbundled build tooling (QA-REPORT).
- Secret scan of real logs with the brief's scanner (`scripts/scan-logs-for-secrets.ts`): none.
- Accessibility review of Moonfold's own UI: 4 mediums and 9 lows fixed. The welcome wizard no
  longer claims usage data is collected by default.
- Performance: splash on every local start, one Windows environment read, parallel Codex probes;
  measurement scripts for server idle (`scripts/measure-server-idle.ts`).
- Remote-access threat model and crash-recovery evidence in QA-REPORT.

### Verification (real output, Windows 11, 2026-10-20)

- Typechecks exit 0 (server, desktop, web). Lint: no new warnings in changed files.
- Tests: desktop 1450 passed, 32 failed, all in the known Windows-only files (CLI shim, symlinked
  settings, Linux snap-shot hosts), identical to the baseline run; os-jank 8/8; recovery suites
  32 passed, 1 skipped; persistence 44/44; web settings and onboarding 645/645. CodexInstallation
  tests use POSIX shell fakes and fail on Windows before and after the change; CI runs them.
- Measured: server idle 0.26 % of one core, 232 MB RSS; scrolling a 5,220-item thread 60.6 to
  63.3 fps at wheel speed; desktop splash 0.94 s, usable window 4.29 s.

### Not verified / open

- QA-REPORT P-1 (medium): cold start to a usable window is 4.3 s against the 3 s budget. This is
  the one item that keeps the Phase 6 gate from being fully met.
- P-2 (low): long frames when a large markdown message mounts while scrolling.
- Packaged-build fuses and installers are Phase 7.

### Next step

Phase 7: release workflows for macOS, Windows and Linux, update feed from our GitHub Releases,
checksums and SBOM, signing docs, install path, Homebrew and winget manifests, REA on artifacts,
v0.1.0-beta.1 pre-release.

## Phase 5: more providers (complete, 2026-10-20)

Plan: docs/plans/phase-5.md. REA gate: docs/REA-PHASE5.md. Decisions: DECISIONS D-36 to D-38.

### Done

- Gemini CLI runs through the ACP integration (registry agent or `gemini --acp` as a local command);
  docs/user/providers-gemini.md explains sign-in.
- Agent-agnostic limit detection for ACP agents: quota and rate-limit wording ends the turn as a
  usage limit, so Gemini and other ACP agents can hand off.
- README provider matrix generated from docs/provider-checks.json (`vp run providers:matrix`), with
  a test that fails on drift.
- No OpenAI-compatible endpoint provider: recorded why (D-37).

### Verification (Windows 11, 2026-10-20)

- Codex and Claude: installed, signed in, models listed, real limit signals and handoff verified
  (Phases 2 to 4). Gemini CLI 0.43.0: ACP handshake verified live; Google refused its
  Google-account sign-in (`UNSUPPORTED_CLIENT`). Antigravity: its managed ACP server was not
  installed; the 125 MB download was left to the owner.
- Tests: ACP registry adapter tests pass apart from its baseline Windows case; provider-matrix
  tests pass.

### Not verified / open

- Gemini CLI with an API key or Vertex AI; Antigravity end to end; Cursor, OpenCode and Grok (not
  installed); macOS and Linux runs of any provider.

### Next step

Phase 6 (hardening): audits, measurements and QA-REPORT.md.

## Phase 4: provider handoff (complete, 2026-10-20)

Plan: docs/plans/phase-4.md. Gate: docs/QA-PHASE4.md. Decisions: DECISIONS D-31 to D-35. Limit
signals: docs/HANDOFF-SIGNALS.md. Owner smoke script: docs/SMOKE-HANDOFF.md.

### Done

- Built on upstream's provider switch (history selection, Codex history injection): every provider
  handoff now records its reason (usage limit, automatic fallback, by the user).
- A deterministic brief (objective, plan, what the user said, files changed, `git status` and
  `git diff --stat`, failing command, open requests, AGENTS.md or CLAUDE.md) opens the new
  provider's first turn; the exact text is kept on the handoff record and shown by "View brief".
- One secret scanner redacts the brief and every history message sent to another provider.
- Preview before sending ("Hand off to…" from the limit notice, thread menu, sidebar menu and
  command palette); a usage-warning offer before a provider stops.
- Settings → Handoff per environment or project: ask or automatic, fallback order, allowed
  agents (enforced at the dispatch chokepoint), usage warning.
- Automatic mode: a scheduler sweep moves a limited thread to the first available fallback, once
  per stopped run, never back to a provider still limited.
- Codex limit stops now carry a reset time even when Codex refuses the turn before sending
  rate limits.

### Verification (real output, Windows 11, 2026-10-20)

- Typechecks exit 0 (contracts, shared, client-runtime, server, web, desktop); `vp run knip:check`
  clean; `vp check` errors only in the untracked `moonfold-website/`.
- Tests: web 6895/6895, contracts 670/670, client-runtime 2088/2088; server orchestration, MCP,
  auth, settings and handoff suites 2569 passed with only baseline Windows failures; shared fails
  only its known Windows cases (symlink, sqlite reader, installer lock).
- Live (QA-PHASE4): a thread stopped at Claude's real limit, previewed and sent to Codex; Codex
  received the brief and then stopped at its own real limit, and Moonfold offered no fallback.

### Not verified / open

- A task finished by the second provider live: both accounts on this machine are at their limits
  (Claude until 1 November, Codex until 17 November). The fake-adapter end-to-end test covers it;
  docs/SMOKE-HANDOFF.md is the owner's script.
- Automatic mode and the usage warning were not exercised live.
- Cursor, OpenCode and other ACP agents report limits as ordinary errors (manual handoff only).

### Next step

Phase 5 (BUILD-PLAN): Gemini CLI adapter (evaluate ACP first), verify the Cursor, OpenCode, Grok
and Antigravity adapters, an OpenAI-compatible endpoint provider if clean; limit signals per
provider into docs/HANDOFF-SIGNALS.md. Gemini CLI 0.43.0 is installed on this machine.

## Phase 3: Codex-parity layer B (complete, 2026-10-20)

Plan: docs/plans/phase-3.md. Gate: docs/QA-PHASE3.md. REA gate: docs/REA-PHASE3.md. Decisions:
DECISIONS D-25 to D-30.

### Done

- Scheduler: one-off and cron schedules in the task's own time zone; run history that follows the
  agent's outcome; per-task completion notifications; tasks bound to a thread, with skills and a PR
  template; the desktop app keeps running in the tray so tasks run with no window.
- Plugins: install a plugin from a folder or git URL (Codex, Claude Code or plain SKILL.md
  layouts), review its skills, MCP servers and their environment, enable, update, disable and
  remove; enabled plugins reach Codex and Claude sessions. Plugins start disabled and an update
  that changes what an MCP server runs turns the plugin off again.
- Memories: local, user-visible and editable, per project or for all projects, delivered to every
  Codex and Claude turn; off for the environment or per thread; agents save through the
  `remember` tool into their thread's project only, and their notes reach providers as quoted data.
- Artifacts: Word and Excel previews in the files panel; a thread's artifacts in its details panel.
- Browser: per-site rules (browse, download, upload x ask, always, block) with questions in the
  thread and Settings to edit them; tab actions check the page before acting and after navigating.
- Computer use (Windows): off by default, per-app approval (this thread or always), in-use bar with
  Stop, a full action log, password fields never read, Moonfold, shell, system and credential
  windows always blocked. macOS and Linux are documented and not built (docs/COMPUTER-USE.md).
- Image generation stays with the providers' own tools; there is no Moonfold-held image API key.
- Security review by a separate reviewer subagent; every finding fixed (QA-PHASE3 lists them).

### Verification (real output, Windows 11, 2026-10-20)

- Typechecks exit 0 for server, web, contracts and provider-core; `vp run knip:check` clean; lint 0
  errors in touched code; `vp fmt` applied by the commit hook.
- Tests: web 6890/6890, contracts 668/668, client-runtime 2088/2088; desktop 34 failures, all in
  files Phase 3 did not touch (Windows path and platform cases); server 93 failed / 6064 passed,
  every failing case also failing in the Phase 1 baseline (94 there; four differ only by the
  t3 → moonfold rename of their titles).
- The 30 test files Phase 3 touched: 647/649. The two misses are Windows-only: the snapshot-path
  test (a JSON-escaped Windows path, failing before Phase 3) and the cross-provider delegation
  integration test, which runs near its 60 s limit here under load (12 s on Linux CI) and passed
  in the full server run.
- Live: every item in docs/QA-PHASE3.md against real Codex (0.161.0, GPT-5.6-Luna); Claude paths by
  unit tests because the Claude account was at its usage limit.

### Not verified / open

- Claude delivery of plugins and memories was not run live (usage limit until 1 November).
- Annotations on streamed browser tabs are deferred (DECISIONS).
- Computer use on macOS and Linux is not built.
- Upstream usage-limit code (`packages/shared/src/usageLimits.ts`, usage-limit sources) talks
  about hubs, pooled accounts and routing cooldowns. Review it against CLAUDE.md rule 7 (never
  pool or proxy logins) in Phase 6 and remove what does not fit.
- `moonfold-website/` is still untracked and untouched.

### Next step

Phase 4 (BUILD-PLAN): provider handoff. Start in plan mode with docs/plans/phase-4.md. Existing
pieces to build on: ContextHandoffService and ContextHandoffDelivery (history selection and Codex
history injection), ProviderSwitchService (`create_with_handoff` transitions), the `handoff` turn
item and its timeline row, usage-limit failure classes in the Codex, Claude, Grok and ACP adapters,
UsageLimitRecoveryWorker and UsageLimitRecoveryBanner (resume at reset), docs/user/portable-handoffs.md.

## Phase 2: Codex-parity layer A (complete, 2026-10-17)

Plan: docs/plans/phase-2.md. Gate: docs/QA-PHASE2.md. Decisions: DECISIONS D-17 to D-24.

### Done

- Codex protocol: contract test against the pinned schema; native review (`/review`, diff panel
  button); `/goal` token budgets; Codex MCP servers (status, OAuth sign-in, reload), skills
  (enable/disable), hooks (grouped by source, runs shown in the thread), imports from other agents
  and account usage on the Codex provider card; archive sync with Codex's own thread; permission
  modes limited to what Codex's requirements allow.
- Built by Moonfold: keybinding search by keystroke; pop-out thread windows with keep-on-top;
  agent instructions editor (Settings → Personalization); keep only the N most recent worktrees;
  edit a proposed plan before implementing; send a failed message again; ask a side question;
  move a thread into a new or existing worktree and bring it back; per-thread usage by model,
  effort and speed; desktop quick window on a global hotkey.
- WebSocket RPCs split into four groups so TypeScript keeps checking handler requirements (D-19).

### Verification (real output, Windows 11)

- Typecheck exit 0; `vp fmt --check` clean; brand and icon checks clean; lint 0 errors in tracked
  code.
- Tests vs the baseline worktree: web 6869/6869, client-runtime 2088/2088, contracts 667/667;
  server 94 failed / 6022 passed with the same failing cases as the baseline; desktop the same 33;
  other packages only baseline failures, plus three load timeouts that also fail in the baseline.
- Live: every item in docs/QA-PHASE2.md against real Codex (0.161.0) and Claude Code (Haiku 5.5),
  including the quick window in the real Electron app with the hotkey pressed through Windows.

### Not verified / open

- "Send a failed message again", hook runs in the thread and the permission-profile picker are
  covered by unit tests only (no failed run, no hooks and no restricted profiles on this machine).
- Codex CLI on this machine is 0.161.0; the schema pin is 0.163.0.
- Plan mode is an upstream legacy setting (off by default); plan editing works when it is on.
- `moonfold-website/` is still untracked and untouched.

### Next step

Phase 3 (BUILD-PLAN): scheduler, plugins and skills marketplace, memories, artifacts viewer,
browser pane with page comments, computer use. Start in plan mode with docs/plans/phase-3.md.
Recon so far: the scheduler has interval, fixed-time and webhook schedules with last-run state
only (no one-off, cron/RRULE, run history or completion notifications); the preview browser and
HTML renders exist; plugins, memories, image generation and computer use do not.

## Phase 1: rebrand and repo hygiene (complete, 2026-10-16)

Plan: docs/plans/phase-1.md. Decisions: DECISIONS D-12 to D-16.

### Done

- Everything renamed to Moonfold by a committed, idempotent codemod (`scripts/brand-codemod.ts`):
  packages `@moonfold/*`, env `MOONFOLD_*`, home `~/.moonfold`, app id `dev.moonfold.app`, scheme
  `moonfold://`, MCP server key `moonfold`, project file `moonfold.json`. CI gate
  `scripts/check-brand.ts` reports no T3 token outside attribution files.
- Removed: mobile app, marketing site, mobile-only patches/scripts/docs, T3-account workflows
  (release, preview, AUR, Vercel, Discord, contribution bots). CI moved to GitHub-hosted runners.
- Hosted services: telemetry opt-in with no embedded key; no default hosted web app (prompt links use
  `moonfold://`, OAuth returns only to local clients); install scripts, schema, privacy page and
  update feed point at this repository; Connect relay dormant (no relay URL in builds).
- Brand: folded-moon icons for all channels, favicons, DMG backgrounds, Icon Composer layers, in-app
  mark, sidebar/welcome/auth identity, stage art; rendered by `scripts/render-brand-icons.ts`.
- Attribution and community: NOTICE, LICENSE line, About > Credits row, README with
  non-affiliation statement, CODE_OF_CONDUCT, CONTRIBUTING, SECURITY, docs/legal/privacy.md.
- REA gate: docs/REA-PHASE1.md (bundle scan clean; runtime capture of the built desktop app shows
  only GitHub, npm, and the user's own Claude and Codex CLIs).

### Verification (real output, Windows 11, 2026-10-16)

- Typecheck `vp run -r --concurrency-limit 2 typecheck`: exit 0, 0 errors.
- Lint: 0 errors in tracked code (pre-existing warnings only).
- `vp fmt --check`: clean. `node scripts/check-brand.ts`: clean. `node scripts/render-brand-icons.ts --check`: clean.
- Tests, compared with the unmodified upstream tree on the same machine (baseline worktree):
  web 6858/6858, client-runtime 2112/2112, contracts 667/667, provider-pi 140/140, ssh 33/33,
  relay 417/417, lint plugin 175/175, release smoke passes. desktop 33, scripts 14, shared 7,
  provider-acp 2 and server 94 failures are **identical to the baseline's** (Windows-only causes:
  symlink privileges, Linux-only cases, tool downloads); the server's file-level failures from the
  full run pass in isolation (load while the desktop build ran). **No regressions from Phase 1.**

### Not verified / open

- Packaged installer: `build-desktop-artifact` needs Visual Studio Build Tools with Spectre libraries
  (not installed here). Phase 7 builds installers in CI and runs REA on the asar.
- The 94 server and 33 desktop baseline failures on Windows are upstream issues; not fixed in Phase 1.
- An untracked `moonfold-website/` folder (a Vercel site, created 02:30-02:39 by someone other than
  this session) sits in the working tree. It is not committed and was not modified.

### Next step

Phase 2 (done, see above).

## Phase 0: recon and decisions (complete, 2026-10-16)

Started 2026-10-15 in a cloud container; finished 2026-10-16 on the owner's Windows 11 machine.
Plan: docs/plans/phase-0.md.

### Done

- Docs added to repo; name set to Moonfold; REA applies to all targets (owner decision).
- Imported T3 Code (MIT) full history as `upstream` (merge `65a3bc9f5`); our `CLAUDE.md` imports upstream `AGENTS.md`.
- Toolchain: Linux (container) and now Windows: Node 24.14.1, `vp` 1.2.0, `vp i`, server + web build (1 m 44 s). Windows caveats in DEV.md.
- **Gate run on this machine** (unmodified fork, `vp run dev --home-dir D:/projects/Moonfold/.t3`, scratch git project):
  - Claude Code (Claude Haiku 5.5, CLI 2.1.293): turn completed, edited `calc.js`, diff panel showed +5/-1, result verified with `node` (`subtract(5,2) = 3`).
  - Codex (CLI 0.161.0): handshake, model list and turn start worked; the account was at its usage limit, so the turn ended with "Usage limit reached" and no reset time. Codex end-to-end editing is therefore **not** demonstrated yet; the limit path is.
- Codex desktop app (Store build 26.1007) reverse-engineered with REA: docs/CODEX-APP-REA.md. Fed into FEATURE-MATRIX.md (new rows) and a first docs/UX-STUDY.md.
- REA server-bundle re-run completed (was a timeout); new outbound hosts attributed in NETWORK-AUDIT.md.
- SIWC subpages read; D-3 decision unchanged with reasons (DECISIONS.md).
- Name re-check: npm free; GitHub user handle `Moonfold` is taken by someone else (org name free); `moonfold.dev` likely free.
- Brand: three concepts drawn, "folded moon" chosen, masters in `assets/brand/`, docs/BRAND.md.

### Verification (real output, 2026-10-16, Windows)

- `vp lint --report-unused-disable-directives`: exit 0, 0 errors, 924 warnings (all upstream code; no code changed in Phase 0).
- `vp fmt --check`: "All matched files use the correct format" (6,743 files) after formatting BUILD-PLAN.md, LAUNCH-PLAN.md and new docs.
- `vp run -r --concurrency-limit 2 typecheck`: exit 0, 0 errors across 32 tasks (Effect diagnostics are suggestions only).
- `vp test run packages/contracts/src/environmentHttp.test.ts packages/contracts/src/orchestrationV2.test.ts`: 2 files, 39 tests passed. Full suite not run (CI owns it; no code changed).
- Contract tests and e2e: none exist yet for Moonfold (Phase 2 adds contract tests).

### Not verified

- Codex completing an edit (account at usage limit at the time of the run). Re-run when the limit resets.
- Desktop (Electron) dev and packaged build; REA on the unpacked asar. Phase 1 gate.
- Owner's hands-on UX notes (UX-STUDY.md is built from REA and docs; D-11).
- Formal USPTO/EUIPO trademark search; reverse image search of the mark.

### Decisions

DECISIONS.md D-1 to D-11. New this pass: D-8 brand mark, D-9 Codex CLI version on the dev machine, D-10 cross-provider handoff stays unique (the official app's handoff is local/worktree/cloud only), D-11 UX study without owner notes.

### Open problems

- `.t3` dev home must always be passed explicitly in the main checkout (DEV.md).
- Running the server CLI while `vp run dev` is up restarts the dev server once (watch mode).
- The web dev client posts traces to `/api/observability/v1/traces` very frequently (hundreds of requests in a few minutes). Check in Phase 1 whether this is dev-only and whether it should be off by default.
- NETWORK-AUDIT TODOs: electron-builder publish owner/repo, server self-update, desktop telemetry publisher, `PreviewBrowser.ts` use of `storage.googleapis.com`.

### Next step

Phase 1 (rebrand and repo hygiene): start in plan mode, write docs/plans/phase-1.md. Rename to Moonfold, remove Clerk/relay/PostHog/app.t3.codes, telemetry opt-in, NOTICE + About + disclaimers, icon set from `assets/brand/`, desktop build + REA gate.
