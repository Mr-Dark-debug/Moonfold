# Changelog

Notable changes to Moonfold. Versions follow [Semantic Versioning](https://semver.org); betas
carry a `-beta.N` suffix. Each release's notes are in `docs/releases/`.

## Unreleased

### Added

- Home screen backgrounds: Settings → Appearance → Home screen puts artwork behind the new thread
  prompt. Choose Moonfold, Golden hour or Purple wind, drawn as ASCII text that follows your theme
  or as an image. Off by default.

## 0.1.0-beta.4

Notes: [docs/releases/v0.1.0-beta.4.md](docs/releases/v0.1.0-beta.4.md).

### Added

- Moonfold for Android beta 1: pair with one QR scan and no account, over an encrypted connection
  pinned to your computer's certificate. It reconnects by itself and survives restarts on both sides.
- Settings → Mobile App, an HTTPS listener that is off by default.
- Content exclusions per project: Claude Code's file tools are blocked, other agents are instructed.
- A token limit for one run, for agents that report usage during a turn.

### Fixed

- The dark theme rendered blue on Chromium up to 133.

## 0.1.0-beta.3

Notes: [docs/releases/v0.1.0-beta.3.md](docs/releases/v0.1.0-beta.3.md).

### Added

- DeepSeek Harness in the agent search, installed with a pinned npx package; its quota and
  balance errors start a handoff.
- Local models for Pi: Ollama and LM Studio models on the same machine, with no edits to `~/.pi`.
- Prompt profiles: standing instructions for every agent, as a default or per thread.
- Scheduled messages: right-click Send, `/timed`, or **Schedule a message for reset** on a usage
  limit.

### Fixed

- Beta installs find new releases again. Beta 1 and beta 2 reported "No published versions on
  GitHub" and need one manual install of this release.
- A prompt profile picked mid-thread now reaches Claude Code, whose session keeps its first system
  prompt.

## 0.1.0-beta.2

Notes: [docs/releases/v0.1.0-beta.2.md](docs/releases/v0.1.0-beta.2.md).

### Added

- OpenCode usage-limit errors start a handoff (#17).
- "Edit this page" links on the docs site (#16).

### Changed

- New ringed-moon logo across the app, icons, installers and docs site; the CLI installers draw
  it in the terminal.
- Betas publish as the latest GitHub release.

### Fixed

- After a handoff the composer follows the thread's new agent.
- node-pty pinned to the patched version, so fresh installs do not pick up an unpatched beta.

## 0.1.0-beta.1

The first Moonfold beta, forked from T3 Code (MIT). Notes:
[docs/releases/v0.1.0-beta.1.md](docs/releases/v0.1.0-beta.1.md).

### Added

- Provider handoff: continue a thread in another agent when one hits its usage limit, with a
  brief you preview before it is sent, secret redaction, a fallback order, allowed agents, and an
  automatic mode.
- Gemini CLI and other ACP agents, with usage-limit detection from their error wording.
- Scheduled tasks, plugins (Codex, Claude Code and SKILL.md), editable memories, a browser pane
  with per-site rules, Word and Excel previews, thread artifacts, and computer use on Windows.
- A provider matrix in the README generated from checks run on real installs.
- Release pipeline for macOS, Windows and Linux with checksums, an SBOM and an update feed on
  this repository's GitHub Releases; install scripts for macOS, Linux and Windows.

### Changed

- Rebranded from T3 Code; T3's hosted services, telemetry key and release accounts removed.
  Telemetry is off unless you configure your own receiver.
- Local desktop starts show a splash at once and read the Windows environment only once.

### Security

- New threads and scheduled tasks start in Supervised mode, which asks before commands and file
  changes; Full access is an explicit choice.
- Desktop IPC answers only the app's own frame; the app's CSP allows inline scripts by hash only;
  session cookies are `Secure` over HTTPS; the app session grants only listed permissions.
- Usage hubs, which pooled provider logins, are removed. Reading Claude's stored login for
  banked resets is opt-in.
- Patched transitive dependencies; QA report in docs/QA-REPORT.md.
