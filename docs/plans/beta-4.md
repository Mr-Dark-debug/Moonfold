# Beta 4 plan: the mobile app, and the real gaps against Copilot

Date: 2026-11-02. Branch: `beta-4`. Brief: the owner's request of 2026-11-02, the Copilot gap
analysis, and the `opencode-mobile` zip offered as a mobile idea.

## What the brief got right, and what it did not

| Gap analysis says missing or partial            | Checked in this repository                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Fleet / Parallel Drafts                         | Shipped: Shift-click several models sends one prompt to each, every one in its own thread and worktree. |
| Side question                                   | Shipped ("Ask on the side").                                                                            |
| Memory                                          | Shipped (Phase 3).                                                                                      |
| Agentic review                                  | Shipped for Codex (`/review`, diff panel); other agents review through ordinary prompts.                |
| Deep links                                      | Shipped (`moonfold://new`, `moonfold://threads/…`).                                                     |
| Opt-in OTel                                     | Shipped (OTLP in Settings → General → Diagnostics).                                                     |
| Session from a pull request                     | Shipped: the pull request panel starts, hands off to and links threads.                                 |
| Content exclusion                               | Missing.                                                                                                |
| Budget stop                                     | Codex goals only.                                                                                       |
| Cloud runners, credits, enterprise, Slack, Jira | Skipped on purpose, as the analysis says.                                                               |

## The zip

`opencode-mobile` is a 909-file Kotlin Multiplatform app whose whole data layer is generated from
OpenCode's REST API. Moonfold speaks a different protocol, so its screens would have to be rewired
one by one, and it duplicates a UI Moonfold already has. Its MIT license also requires its
copyright notice in every copy, which conflicts with the owner's wish for no earlier contributors'
names. So it is used as an idea only and **no code, assets or strings are copied** (D-57).

## Scope

### 1. Moonfold for Android (`apps/mobile`, D-57, D-58)

- A small native Android app of our own: splash, QR scanner, a full-screen view of the host's own
  Moonfold web client, and a "waiting for your computer" screen that retries by itself.
- No account and no login. Scanning is the only step. The session lives in the app's cookie store,
  so closing and reopening needs no new scan while the host keeps running.
- iOS is not in beta 1: it cannot be built or tested on this machine.

### 2. A secure connection to the host (D-58)

- The server gains a second, HTTPS listener for the network (self-signed certificate created on
  first use and kept in the Moonfold home). Same app, same auth, same WebSocket.
- The QR carries the addresses, the certificate's SHA-256 and a one-time pairing token. The app
  trusts that certificate only, so nobody on the network can read or impersonate the connection.
- Paired phones appear in Settings → Connections and can be revoked there.
- A paired mobile session lasts 365 days, so an idle phone is not signed out after 30.
- Reach: same Wi-Fi, or any network the phone shares with the host (Tailscale, VPN).

### 3. Settings → Mobile App

Turn it on, see the QR, see paired phones. Off by default, like every network exposure.

### 4. Desktop gaps

- Content exclusion per project: paths agents must not read. Enforced where Moonfold can enforce
  it (D-59), and stated plainly where a CLI only receives an instruction.
- A token limit for one run where usage is reported (D-60).

### 5. Release

0.1.0-beta.4 and a Moonfold Android beta 1 APK on the same GitHub release, website and docs.

## Not in beta 4

- Connectors (X, Reddit, GitHub, Slack): recommended for later, as curated MCP entries in the
  plugin list, each with the owner's own token. They add accounts and outbound posting, and need
  their own review. The plugin and MCP manager already lets a user add any of them by hand.
- Reaching the phone from anywhere with no shared network: this needs a relay or tunnel someone
  runs. Moonfold runs no hosted service (CLAUDE.md rules 6 and 7), so it stays Tailscale or VPN.
- iOS; push notifications; craft skill packs; canvas; headless `moonfold run`.

## Gates

Targeted tests, typecheck, `vp check`, knip, brand check; the Android app built here and exercised
on an emulator against a real dev server (scan path, restart, relaunch, revoke, wrong certificate);
docs/QA-BETA4.md with the real results; REA gate on the APK; main CI green before tagging.
