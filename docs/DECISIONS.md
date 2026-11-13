# Decisions

## D-1 Name: Moonfold (owner decision, 2026-10-15)

Availability check (this session; not legal advice):

- GitHub: no conflicting project. Similar names only: `ffwangyue/MoonFolder`, `WhalenKaiser/moonFold.py` (both dormant, unrelated).
- npm: `moonfold` and `@moonfold/cli` return 404 (free). Reserve the package name before first publish.
- Domains: `moonfold.com` and `moonfold.app` resolve to other owners. `moonfold.dev` and `moonfold.io` had no DNS record (may be free, unverified; check a registrar).
- Trademark (USPTO/EUIPO): **not checked** (no access from this container). Owner action.

Re-check 2026-10-16 (Windows machine):

- npm: `moonfold`, `@moonfold/cli`, `@moonfold/desktop` still 404 (free).
- GitHub: the org name `moonfold` is free, but a **personal account `Moonfold` exists** (created
  2023-05-24, 0 public repos). We cannot use `github.com/moonfold`; keep `Mr-Dark-debug/Moonfold`
  or register an org such as `moonfold-app` / `moonfoldhq` (owner's call, account action).
- Domains via RDAP: `moonfold.com` and `moonfold.app` registered; `moonfold.dev` returned "not
  found" from the registry (likely available). `.io`, `.ai`, `.sh` returned not found from
  rdap.org, which does not cover all ccTLDs, so they are unverified. Check at a registrar.
- Web search for "Moonfold" with trademark/software/app terms: no matching product or mark found.
  A formal USPTO/EUIPO search is still an owner action before launch.

## D-2 Base: T3 Code (MIT), imported with full history

`upstream` remote = `pingdotgg/t3code`. Merge commit `65a3bc9f5` joins upstream `main` (at `17e1087d3`) with our docs. `CLAUDE.md` is ours and imports upstream `AGENTS.md`. Keep upstream LICENSE; add NOTICE in Phase 1.

## D-3 Auth path

Source: developers.openai.com/siwc, its open-source subpage, and the app-server docs.

- App-server docs state app-server authentication "has never been permitted for commercial or hosted services".
- Sign in with ChatGPT (SIWC) lets open-source and locally hosted apps request permission to use the user's ChatGPT plan for eligible Responses API calls. Requires a stable opaque `ext_agent_host_id` (recommended `urn:uuid:` or jwk-thumbprint form, never user-identifying), state + nonce + PKCE with a loopback callback, token validation, `stream:true`, `store:false`. Paid or remotely hosted apps are out of scope.
- **Decision**: Moonfold is free, local and open source and never hosts or pools tokens (CLAUDE.md rule 7). Default path stays the user's own local `codex` CLI login, as T3 does today. SIWC registration for Moonfold's own direct API use is deferred until a feature needs it, and requires the owner to register. The SIWC subpages for app-server, preview limitations and token reference were **not read in full** (only the open-source overview); read them before any SIWC work.

## D-4 Handoff builds on T3's existing context handoff

T3 already has `ContextHandoffServiceV2` (textual, budgeted, no limit trigger, no redaction or preview). Phase 4 extends it (brief with plan/diff/open problems, limit triggers, redaction, preview, fallback order) instead of writing a second mechanism.

## D-5 Feature matrix starts from "T3 may already have it"

A keyword probe shows T3 already has substantial overlap with the Codex app (scheduled tasks, preview browser, usage, goals, plan/interaction modes, skills, memory, subagents, archive, pin, fork, compaction). Phase 2 and 3 become audit-and-fill, not build-from-zero. See FEATURE-MATRIX.md.

## D-6 REA applies to all targets (owner decision)

See CLAUDE.md "REA everywhere". Rule 3 (no copying names, logos, assets, UI strings) stays.

### D-3 addendum (2026-10-16): SIWC subpages read

Read the app-server, token reference and preview-limitations pages of the SIWC open-source guide.

- With SIWC, an app passes the user's SIWC access token to a child `codex app-server` through its
  environment, restarts app-server with a fresh token when it refreshes (access tokens last one
  hour, refresh tokens 30 days and rotate), then re-initializes and resumes the thread.
- Preview limits: no hosted tools (image generation, file search, code interpreter, computer use,
  hosted MCP), storage off, streaming on, no response chaining over HTTP.
- `model/list` is not proof of access; only a completed turn proves it.
- `clientInfo.name` must stay stable and match the name given at SIWC registration.

Decision unchanged: Moonfold drives the user's own logged-in `codex` CLI. SIWC would add token
storage and refresh to Moonfold, and its preview removes features we want (hosted tools). Revisit
only if a feature needs direct Responses API calls; that needs owner registration.

## D-7 GitHub default branch (resolved)

`main` is the default branch on GitHub (checked 2026-10-16).

## D-8 Brand mark: the folded moon (2026-10-16)

Three concepts drawn and rendered at 256/128/32/16 px. Chosen: a moon disc with its cap folded
over along a crease (moon phase plus fold, which reads as handoff). Ink navy background, amber
accent. Details and files: docs/BRAND.md. Owner can override. Reverse image search is a Phase 1
item before the icon ships.

## D-9 Codex CLI version on the dev machine

The schema pin is codex-cli 0.163.0 (PROTOCOL.md). The owner's machine has 0.161.0 on PATH, which
T3 used for the Phase 0 smoke run. We do not upgrade the owner's global CLI. Phase 2 contract tests
pin and install 0.163.0 into a tools folder and point Moonfold's Codex binary path at it.

## D-10 Codex app REA: positioning

The installed Codex desktop app (26.1007) has a "hand off" that moves chats between checkout,
worktree, cloud and phone, but never to a different agent provider. Cross-provider handoff stays
Moonfold's headline. The app's plugin folder layout (manifest + skills + MCP config) is the format
Moonfold should read in Phase 3. Details: docs/CODEX-APP-REA.md.

## D-11 UX study without owner notes

The owner asked for Phase 0 to proceed without questions. docs/UX-STUDY.md is therefore built from
REA and public docs and says so; owner notes, when added, override it. This does not block Phase 1.

## D-12 Phase 1 scope cuts (2026-10-16)

- `apps/mobile` removed: the beta excludes mobile, the app ships through T3's store and EAS
  accounts with T3-forked native packages, and iOS cannot be built on this machine. Recoverable
  from git history (`29657ea33^`).
- `apps/marketing` removed: it is T3's website. A docs site comes in Phase 8.
- `infra/relay` kept, renamed, not deployed. Moonfold Connect stays dormant because builds inject
  no relay URL. Self-hosting it needs owner cloud accounts (Cloudflare, Clerk, APNs/FCM).
- T3 release, preview, AUR, Vercel, Discord and contribution-bot workflows removed; CI moved from
  Blacksmith runners to GitHub-hosted runners. The release pipeline is rebuilt in Phase 7.

## D-13 Rebrand by committed codemod

`scripts/brand-codemod.ts` maps T3 identifiers to Moonfold ones (packages `@moonfold/*`, env
`MOONFOLD_*`, home `~/.moonfold`, app id `dev.moonfold.app`, scheme `moonfold://`, MCP server key
`moonfold`, project file `moonfold.json`). It is idempotent so it can be re-run after upstream
merges. It never rewrites T3 domains (left for `scripts/check-brand.ts` to flag) or the upstream
attribution link. Data directories differ from T3's, so Moonfold never touches a T3 install.

Fallout fixed by hand: the vendored Ghostty write-pty WebAssembly import was renamed to
`moonfold_write_pty` by re-encoding its import section; T3's two MCP tool-name spellings
(`t3-code` / `t3_code`) collapse to one, so Pi registers each tool once; temporary worktree
branches match only `moonfold/<hex>` and `moonfold-<hex>` (no legacy forms).

## D-14 No hosted web app

Moonfold has no equivalent of T3's hosted `app.t3.codes`. The hosted app URL is optional and
empty by default. Prompt links fall back to `moonfold://` deep links, hosted pairing links are not
offered, and OAuth return URLs are accepted only for local clients (loopback web or the desktop
scheme). A build can still configure `VITE_HOSTED_APP_URL` if one is deployed later.

## D-15 Telemetry opt-in with no embedded key

PostHog telemetry is off by default and needs `MOONFOLD_TELEMETRY_ENABLED=true` plus the user's own
`MOONFOLD_POSTHOG_KEY` and `MOONFOLD_POSTHOG_HOST`. T3's project key was removed.

## D-16 Icons rendered from one model

`scripts/render-brand-icons.ts` renders every icon (three channels, macOS safe area, ICO, favicons,
DMG backgrounds, Icon Composer layers) from the folded-moon geometry, and `--check` runs in CI.
Apple's Icon Composer export is not used because it requires macOS.

## D-17 /review, goal budgets and their syntax

`/review` maps to Codex's `review/start` with inline delivery: no argument reviews uncommitted
changes, `branch <name>` or `base <name>` a base branch, `commit <sha>` one commit, and any other
text is custom instructions. `/goal --budget 200k <objective>` and `/goal budget <tokens|off>` add
token budgets; a budget-only `thread/goal/set` keeps the objective and status, and `null` clears
the budget (checked against codex-cli 0.161.0). The command palette has no provider commands, so
`/review` is reached from the composer and the diff panel only.

## D-18 Provider-native configuration lives on the provider card

MCP servers, skills, hooks, imports from other agents and account usage are Codex's own
configuration, so they live on each Codex provider's settings card, not on new top-level settings
pages. Each Codex instance can use a different Codex home and account, and the card is already
per instance. Account usage sits there too rather than on the Usage page, which reports local
transcripts across providers. The server side is a provider-neutral `nativeConfig` capability, so
another provider can implement it later. Each call spawns a short-lived `codex app-server`; a
section loads only when opened.

## D-19 WebSocket RPCs are declared in four groups

TypeScript gives each statement a fixed instantiation budget, and the cost of an RPC group's
handler types grows with the square of its size. At about 300 RPCs the server's handler map
silently degraded to `any`, so missing services stopped being reported. The contract now declares
the RPCs in `WsRpcGroupPart1..4` (merged for clients); the server builds the handlers once and
gives each part only its own. New RPCs go into the last part. `apps/server/src/binCli.types.test.ts`
fails to compile if the CLI's requirements widen to `any` again.

## D-20 Side questions use text generation, not a turn

"Ask on the side" sends the thread's recent conversation and the question to the thread's own
model through the provider's text-generation path (no tools, no thread history written). It never
interrupts or queues behind a running turn and costs one short request. Providers without text
generation (ACP) report it as unsupported.

## D-21 Permission modes follow Codex's own requirements

Codex lists its allowed permission profiles (`permissionProfile/list`). Moonfold maps the built-in
`:read-only`, `:workspace` and `:danger-full-access` profiles to its runtime modes and offers only
the allowed ones, so an organization's Codex requirements cannot be bypassed from the picker.

## D-22 Moving a thread between the project folder and worktrees

A user move reuses the agent's worktree handoff service, so the WebSocket RPCs and the MCP tool
share one per-thread guard. A move waits until no run is active. Uncommitted work travels through
git's shared stash; a failed apply resets the target and restores the source, which is why the
target must be clean. A new worktree always branches from the checkout's own HEAD, never origin,
because that is the base the carried work was written against. Bringing work back merges the
worktree branch into the project folder's branch and aborts on conflict, so the folder must be
clean first and a failure changes nothing. The worktree stays on disk; retention removes it later.
Agents get only the existing one-way handoff tool: merging into the user's checkout stays a user
action.

## D-23 Per-thread usage lives in the thread details panel

Codex and Claude report main-agent usage per turn. Moonfold groups it by the run's model, effort
and speed and shows it under Usage in the thread details panel. The composer's context meter was
considered but is a legacy indicator that is off by default.

## D-24 The quick window is a pop-out of the new-thread screen

The global hotkey (a client setting, off until recorded) opens an always-on-top pop-out window at
the app's index route, which already starts a draft in the most recent project. No separate
renderer or route is needed, it works with every provider, and the window behaves like any
pop-out (sidebar collapsed, keep-on-top toggle). The hotkey is released while a new one is being
recorded, and a hotkey held by another app is reported in Settings.

## D-25 Schedules are our own cron, in the task's time zone

One-off and cron schedules use a small cron parser of our own (five fields, presets in the UI)
rather than an RRULE dependency. Times are read in the task's IANA time zone so a task keeps its
local time wherever the server runs. A one-off whose time passed while Moonfold was down is marked
missed instead of running late. A run's status follows the agent's turn, not the hand-off of the
prompt.

## D-26 Plugins are folders that start disabled

A plugin is a git repository or a copied folder of `SKILL.md` skills and optional MCP servers; the
Codex and Claude Code plugin layouts load as they are. Nothing reaches an agent until the user
turns the plugin on, and turning on one with MCP servers lists the programs it will run. An update
that changes those servers turns the plugin off again. Codex receives skills through
`skills/extraRoots/set` and servers in the thread's `mcp_servers` config; Claude through the SDK's
local plugins option. Other providers do not load plugins yet. A plugin's servers are not
pre-approved; the thread's permission mode decides each call.

## D-27 Memories: one store, two trust levels

Memories live in the environment's database, for every project or one. Each Codex and Claude turn
receives them unless memories are off, as a whole or for the thread. What the user wrote is
delivered as the user's own instruction (Codex developer context, Claude system prompt); what an
agent saved through `remember` is delivered as background (Codex untrusted context, its own
labelled block for Claude, quoted as a JSON list with angle brackets escaped), so a misled agent
cannot plant an instruction for later turns. An agent saves only to its thread's project; only the
user widens a memory to every project. Editing an agent's memory makes it the user's. Codex's own memory feature is not overridden: when a user
has it on, Codex may keep things there, and the guide says how to ask for Moonfold's.

## D-28 Office previews are read in the browser

.docx renders through mammoth (BSD-2-Clause, loaded on first use) and DOMPurify, without scripts,
styles or remote images. .xlsx is read by a reader of our own on JSZip and the browser's XML
parser, avoiding the npm SheetJS build with known advisories. The server only serves the bytes,
as types a browser downloads rather than runs.

## D-29 Agent browsing rules sit at the browser tools

Rules apply where agents ask the browser to act: `preview_open` and `preview_navigate` check the
target, `preview_upload` the page the files would go to. A page reached by clicking a link is not
checked, and downloads are not covered yet; the guide says to block sites outright rather than
rely on asking. Local servers are always allowed. Asks wait up to five minutes and are answered
from any connected client. Annotations on streamed (non-desktop) tabs are deferred: the stream
carries pixels only, and drawing on it needs its own protocol work.

## D-30 Computer use is Windows-first, through our own helper

A PowerShell helper uses UI Automation, SendInput and window capture, all built into Windows, so
nothing extra ships. It runs only while computer use is on. Apps are approved per thread or
always; Moonfold's own windows (by process or a title naming Moonfold) and the Windows credential
and consent screens are never reachable, and Windows keeps elevated apps out of reach. Clicks are
refused when another window covers the point, and password fields are detected by UI Automation
and by the edit control's password style. The log never stores typed text. macOS and Linux are
documented but not built: they cannot be verified on this machine. A provider's own computer use
(some Codex installs carry one) runs outside these controls; the guide says so.

## D-31 Provider handoff builds on the existing provider switch

Upstream already moves a thread between providers: `message.dispatch` with another model
selection starts a new native session and `ContextHandoffService` sends a budgeted selection of
the history (Codex as injected items, others inline). Phase 4 adds what that path lacked instead of
a second mechanism: a reason on every provider handoff (`usage_limit`, `automatic`, `manual`), a
deterministic brief ahead of the history, secret redaction of everything sent, a preview, the
allow list, and the triggers. A handoff is one `message.dispatch` carrying `handoffReason`, so
receipts make it idempotent and every entry point (dialog, banner, fallback worker) shares it.

## D-32 The brief is built from the log, sent once, and kept on the handoff record

The brief is a pure function of the thread's turn items, the workspace's `git status --short` and
`git diff --stat`, and AGENTS.md or CLAUDE.md, with no model call (`handoff/handoffBrief.ts`,
golden-tested). The turn that delivers a provider handoff builds it, prepends it to the prompt and
stores the exact text on the context-handoff record; a retry reuses the stored text. The record's
brief is stripped from the wire projection (it can be several kilobytes) and read on demand for the
divider's "View brief". The preview builds the same brief from the same state, so what the user
reviews is what is sent unless the thread or workspace changes in between.

## D-33 Redaction is one scanner, applied to everything that leaves for another provider

`@moonfold/shared/secretRedaction` replaces provider keys, tokens, private keys, JWTs, bearer and
basic credentials, URL credentials and literal secret assignments with `[REDACTED:<kind>]`. It
errs toward redacting. It runs on the brief and on every history message of a provider handoff;
same-provider handoffs (restarts, retries) are unchanged.

## D-34 The allow list defaults to every enabled provider and is enforced at dispatch

`providerHandoff.allowedProviders: null` keeps upstream's behavior (any enabled provider may
receive a thread). A project that lists providers is enforced in `ThreadManagementService`'s
dispatch chokepoint: a turn on a provider other than the thread's last run is refused when that
provider is not listed, whatever started it (dialog, model picker, scheduled task, agent).

## D-35 Automatic handoff runs on the scheduler, once per stopped run

`auto` mode is opt-in. The `provider-handoff` sweep reads persisted state only, skips projects in
`ask` mode before loading a thread, picks the first fallback that is allowed, enabled and not
itself stopped at a limit whose reset is still ahead, and dispatches with command id
`handoff-auto:<runId>`, so restarts and repeated sweeps never move a thread twice for one stop.
Agents get no handoff tool: sending a thread's context to another company is the user's choice.

## D-36 Gemini CLI runs through the ACP integration, with agent-agnostic limit wording

Gemini CLI speaks ACP (`gemini --acp`), so it needs no dedicated driver: it is added from the ACP
Registry or as a local ACP command. The registry adapter forbids new agent-specific branches, so
limit detection is agent-agnostic: an ACP request error whose message reports an exhausted quota
or rate limit is a `usage_limit`. On this machine Google refused Gemini CLI's Google-account
sign-in for individuals (`UNSUPPORTED_CLIENT`), so Gemini is listed as not verified until it runs
with an API key or Vertex AI.

## D-37 No OpenAI-compatible endpoint provider in this phase

Every Moonfold provider wraps an agent that owns its tools, sandbox and sign-in. An
OpenAI-compatible endpoint is only a model API: supporting it would mean Moonfold running its own
agent loop (tools, edits, approvals) and storing an API key, which no adapter does and which would
duplicate what ACP agents already provide. Users who want an OpenAI-compatible model can run an
ACP agent that supports one (for example through the ACP Registry). Revisit if a maintained,
license-compatible ACP agent for generic endpoints appears.

## D-38 The README provider matrix is generated from recorded checks

`docs/provider-checks.json` records checks that ran on a real install (CLI version, platform, date,
install, sign-in, models, turn, limit signal, handoff). `node scripts/provider-matrix.ts` renders
the README table, and a test fails when the README drifts. A provider is "Verified" only when every
live check passed; adapters inherited from upstream that were not run here are listed as not
verified rather than hidden, so users see the real state.

## D-39 Usage hubs are removed

A usage hub (an external proxy that holds several provider logins and hands out quota) is exactly
the login pooling CLAUDE.md rule 7 forbids, so Moonfold no longer adds, reads or refreshes hubs.
Settings still lists hubs saved by an older build, with Remove only, so the stored management key
can be deleted. Usage limits come from each provider's own CLI.

## D-40 Reading Claude's stored login for banked resets is opt-in

Showing Claude's banked reset credits needs the token Claude Code stores for the user. Reading it
without being asked is too much for a convenience, so a switch in Settings → Usage turns it on and
it is off by default. Nothing is sent anywhere except Claude's own API.

## D-41 The desktop CSP allows inline scripts by hash only

The app's HTML has a few inline bootstrap scripts. Instead of `unsafe-inline`, the custom protocol
handler hashes each inline script in the HTML it serves and lists the sha256 values in
`script-src`. Sign-in origins appear only when the build configures a self-hosted Clerk instance;
T3's hosted values are gone from `.env.example`.

## D-42 Desktop IPC answers only the app's own frame

All IPC handlers go through one wrapper that checks the sender frame's URL is the app
(`moonfold://app/`, or the dev scheme). Preview webviews, embedded pages and any other frame are
refused. Doing it in the wrapper means a new channel cannot forget the check.

## D-43 Faster local starts: one environment read, and a splash right away

The desktop already reads the user's Windows environment (PATH and the rest) before it starts the
backend and tells it so; the backend now trusts that instead of spawning PowerShell again. Every
local start shows the "Starting Moonfold…" splash immediately, as WSL starts already did, so the
window is never blank while the backend boots.

## D-44 Cold-start budget: measured, not yet met

The budget is read as time from launch to a window the user can work in. Measured warm on a
Windows laptop: splash 0.94 s, usable window 4.3 s. The remaining time is evaluating the server
bundle (about 1.2 s) and building its services (about 1.3 s), so meeting 3 s means starting to
listen before providers and device support finish loading. That is a server startup change large
enough to need its own work item; it is recorded as open (QA-REPORT P-1) rather than declared met.

## D-45 Releases build on GitHub-hosted runners, one stable train with betas

`release.yml` builds every target on GitHub-hosted runners (macOS, Windows and Linux, x64 and
arm64) and publishes to this repository's Releases. Moonfold publishes no nightly or preview
channels; the workflow refuses those versions. A `release-dry-run/<version>` branch runs the full
build without publishing, because a manual run only works once the workflow is on `main`. Signing
steps run only when their secrets exist, so the owner turns signing on by adding secrets.

## D-46 Betas belong to the main train

`moonfold update` already treated any version that is not nightly or preview as the main train.
The install scripts now do the same, so `-beta.N` and `-rc.N` releases install by default, and a
desktop beta install accepts GitHub prereleases so it updates to the next beta and then to the
stable release. A stable install never sees prereleases.

## D-47 Server updates wait for the GitHub release, not npm

Servers installed from release archives download updates from GitHub Releases. The client used to
wait until the version appeared on npm, which Moonfold does not publish to, so every server update
was skipped. It now waits until the GitHub release exists with its `SHA256SUMS`. Publishing to npm
needs the owner's npm account; until then the docs do not promise `npx moonfold`.

## D-48 No CLI archive for Intel macOS

The Node single-executable for Intel macOS crashed (SIGSEGV) in its smoke test on the release
runner, as it did upstream. Intel Macs get the desktop app; docs/user/install.md explains how to
run the server from source there.

## D-49 New threads start Supervised

The default permission mode was inherited as Full access. CLAUDE.md requires the safest mode by
default, so `DEFAULT_RUNTIME_MODE` is now `approval-required` (Supervised): new threads,
environments whose settings never chose a default, and new scheduled tasks ask before commands
and file changes. Users opt into Auto-accept edits, Auto or Full access in the composer or in
Settings → General → New threads → Permissions; threads and saved defaults keep what they had.

## D-50 The docs site is built by a small script, not a site framework

`scripts/build-docs-site.ts` renders `docs/user/*.md` with `marked` (MIT, already in the lockfile)
into plain HTML with one stylesheet, and `pages.yml` deploys it. A site framework would add a
toolchain and dependencies for 45 pages of Markdown; the script keeps the user guides as the one
source, rewrites links between them, and links everything else to GitHub. Internal docs
(`docs/internals`, plans, QA records) are not published there.

## D-51 A new mark drawn from one parametric model

The logo is now a crescent moon inside a tilted orbit ring with a four-point star, drawn by
`scripts/lib/brand-mark.ts`. Every icon, favicon, the social image, the docs site and the in-app
`MoonfoldMark` come from that model, so they cannot drift apart. Small sizes use a flat variant
with a thicker ring; one-colour uses a gap cut along the ring. The CLI installers draw the same
mark in half-block pixels, in mid-tone colours that read on dark and light terminals.

## D-52 Betas publish as the latest release

GitHub hides prereleases from the repository sidebar, so the first beta showed only as a tag.
Until 1.0, betas are the public line: `release.yml` publishes `-beta.N` and plain versions as full
releases marked latest, and only `-alpha.N` and `-rc.N` as prereleases. The installers, the CLI
and the desktop updater list releases rather than asking for "latest", so the flag changes only
what GitHub displays. v0.1.0-beta.1 was edited to match.

## D-53 DeepSeek Harness joins through a small catalog supplement

DeepSeek Harness (`@deepseek-ai/dsh`, MIT) serves standard ACP with `dsh --profile acp` but is not
in the public ACP Registry. Moonfold adds a built-in supplement to the registry catalog: entries in
the registry's own schema, listed, installed (`npx` with a pinned version) and launched exactly
like registry agents. It is data, not a per-agent adapter branch. `npx` also avoids the Windows
`.cmd` shim that local commands refuse. dsh's quota and balance errors join the shared ACP
usage-limit wording, so handoff works without agent-specific code. Moonfold does not add a
"DeepSeek opener" to prompts: dsh builds its own system prompt.

## D-54 Prompt profiles ride the existing instruction channels

A prompt profile is a named block of standing instructions: built-ins written in our own words
(no provider's proprietary prompt text is copied), plus user profiles in `settings.json`. The
environment has a default, a thread can override it (`promptProfileId` on the thread, set through
`thread.metadata.update`). Each turn resolves the profile next to memories and every adapter sends
it the way it already sends Moonfold's runtime instructions: Codex `additionalContext`, Claude's
appended system prompt, the runtime block for ACP agents, Cursor, Muse, OpenCode and Pi. It never
edits AGENTS.md or CLAUDE.md, and it is not a way to replace a provider's own system prompt.

## D-55 Scheduled send is a one-off task bound to the thread

"Schedule send" (right-click on Send, or `/timed`) creates a scheduled task with a `once`
schedule and the thread's id. The scheduler already survives restarts, queues behind running
work and records runs, so there is no second scheduling system. Scheduled runs carry text only,
so a draft with attachments cannot be scheduled. Natural-language times ("tomorrow 9am") are
parsed in the web client with our own small parser and tests.

## D-56 Local models go through agents that already have a loop

Ollama and LM Studio serve models, not coding agents. Moonfold detects them on loopback and
offers their models to Pi (and documents the same for DeepSeek Harness and OpenCode), which
already have tools, approvals and an agent loop. Moonfold writes the endpoint into an agent
directory it owns for that Pi instance and never edits the user's own `~/.pi` unasked. A local
model is then an ordinary provider/model pair and can be the last step of the handoff fallback
order. A native Ollama provider with Moonfold's own agent loop is not planned.

## D-57 The mobile app is our own thin client of the host's web UI

The offered `opencode-mobile` zip is MIT licensed, so shipping any of it would require keeping its
copyright notice, and its data layer is generated from another product's API. Moonfold's Android
app is written from scratch instead: a native shell (splash, QR scanner, reconnect screen) around
the web client the host already serves. Every feature reaches the phone with no second UI to
maintain, which is what "show everything" asks for. No code, assets or strings come from the zip.

## D-58 Phones connect over pinned TLS with no login

Pairing stays the existing one-time token; the phone never sees an account. The server adds an
HTTPS listener for the network with a self-signed certificate, and the QR code carries its SHA-256.
The app accepts that certificate and no other, which gives encryption and host identity without a
certificate authority, a domain or a hosted service. A mobile session lasts 365 days instead of 30,
so an idle phone is not signed out, and it is revoked like any other client. Reaching the host needs
a shared network (Wi-Fi, Tailscale, VPN); Moonfold runs no relay.

## D-59 Content exclusions are enforced where Moonfold can, and say so where it cannot

A project lists paths agents must leave alone, in Settings → Prompt Profiles → Agent limits. They
travel with the prompt profile, so every adapter delivers them and a change reaches a running
session the same way. Claude Code also receives them as its own deny rules, which block its file
tools outright. Other harnesses have no equivalent Moonfold can set, so for them this is an
instruction, and no harness stops a shell command. The setting says this plainly rather than
promising a guarantee. The brief's D-60 (enforced in Moonfold for every provider) would need a
sandbox around each CLI, which Moonfold does not have.

## D-60 The budget stop counts tokens a run adds to its context

Providers report context size during a turn and cumulative totals only when it ends, so a stop
that can fire mid-turn counts what the run adds, and ignores the conversation it started from. It
is a project setting, not a counter on the thread: each message starts a new run with a fresh
allowance, so the limit stops a runaway task without locking the thread. It reads tokens, not
money, because subscriptions report no price. Agents that report no usage during a turn are not
limited, and the setting says so.

## D-61 The Android release key lives outside the repository

Android requires every update to carry the same signature, so the key cannot be replaced later
without users reinstalling. It was generated for beta 1 on the owner's machine in
`~/.moonfold-release` with its password beside it, and it is not in the repository or in CI. The
APK is built locally and attached to the GitHub release.

## D-62 Upstream's design overhaul arrives through the upstream sync

Upstream T3 Code redesigned its UI in pull request 24865 and later made the new design the only
one, with no toggle (pull request 25778). Moonfold takes it through the upstream sync (D-64) rather
than a hand port, so there is no "New design" setting and nothing to keep in step later. Moonfold's
own screens (handoff, Mobile App, prompt profiles, agent limits, welcome wizard) were not part of
that review and still need the scored review loop in docs/plans/ui-refresh.md.

## D-63 Cassandre: a brand kit is files in the project, built by a profile and checked by a service

A message that starts with `/brand` runs Cassandre: a built-in prompt profile every provider follows,
and the app then pins the thread to it. The exact parts (validation, contrast, exports, rendering,
name lookups, kept references) are a `BrandKitService` reached through `brand_*` MCP tools, and
decisions go to the user through `moonfold_ask_user` question cards, whose options can show pictures.
The kit lives in `.moonfold/brand/` with a DTCG `tokens/tokens.json` as the source of truth; exports
are generated from it, never written by hand. References inform principles and are never copied, and
`references/` stays out of git. The owner chose that the agent searches design galleries itself,
Pinterest and Dribbble included (2026-11-06), so this runs under the agent browsing site rules and
the user guide says which sites forbid automated browsing and how to block them. Plan:
docs/plans/cassandre.md.

## D-64 Upstream sync of 2026-11-06, and how to repeat it

Moonfold merged upstream T3 Code `202d5b561` (4,004 commits after our base `17e1087d3`). Both sides
were first run through `scripts/brand-codemod.ts` and merged against a rebranded copy of the old
base, so renames never conflicted; the merge commit's parents are Moonfold `main` and the real
upstream commit. Repeat the same way next time, with the last merged upstream commit as the base.

Left out on purpose: upstream's Expo phone app (Moonfold has its own Android app), its marketing
site, the hosted CI cache, Expo/React Native patches, and anything that pools provider logins.
Upstream's hosted relay ("Connect"), guest links and hosted account pages stay in the code but only
switch on with a hosted sign-in key, which Moonfold does not ship; the brand check skips those
files rather than renaming services that are not ours. Where upstream built a feature Moonfold
also had (Office previews, one-off scheduled tasks, preview actions), upstream's version won and
Moonfold's extras (cron schedules, run history, per-site browsing rules) were moved onto it.

## D-65 Home screen backgrounds ship in the app, off by default

The owner asked for a more engaging new-thread screen than a bare prompt. Settings → Appearance →
Home screen picks a background (None, Moonfold, Golden hour, Purple wind) and a style (ASCII text or
image). Two client settings, saved per device like the other appearance settings, no server change.
The default is None so existing installs look the same after updating; changing it is one constant
in `packages/contracts/src/settings.ts`. The artwork is bundled with the web client and loaded only
when chosen, so it works the same over remote connections.

The ASCII text is the owner's own conversion of each picture, drawn as SVG text so it scales to any
window and follows light and dark themes (the tones are mirrored for light themes, and four ink
strengths keep the picture readable). The PNGs are the owner's coloured renderings of the same
conversion, used unmodified.

Provenance: the owner supplied all three scenes. The Moonfold mark is ours. The two landscape
pictures were converted from source images whose origin and licence this repository does not
record; the owner confirms the right to redistribute them before a release that includes them.

Written on the branch as D-64; renumbered when it merged after the upstream sync took that number.

## D-66 The Windows payload budget is 84 files

The 0.1.0-beta.5 release dry run failed on Windows x64: the unpacked app held 82 files against
upstream's budget of 80 (arm64 held 80). The error now names where the files are. Of the 82, 16 sit
at the root (Electron's own files, among them three SwiftShader and Vulkan files that arm64 does not
ship), 65 under `resources/`, and one locale. Twelve of those are server compile-cache files, one
per server bundle chunk, so they grow with Moonfold's own server code. The budget exists to stop
wholesale unpacking, which adds hundreds of files, so it moves to 84: room for a little growth, and
a new tripwire well below the cost that matters. Not done: removing the SwiftShader fallback, which
renders on machines without a usable GPU.

## D-67 One living mark, not a mascot per feature

The brief that asked for this called it D-64; that number was taken. Moonfold gets one brand
character, and it is the mark itself: the crescent, ring and star, moved by state (idle, working,
waiting, done, attention). There is no mascot per feature and none per skill, because skills are
written by users and have no upper bound. Reviewers in a multi-provider round get seat glyphs made
from the same geometry (moon phase and star position), never provider logos. Skills get one icon
per source kind. All of it comes from `scripts/lib/brand-mark.ts`, is drawn by one component, and
moves with transforms and opacity only, with a still pose per state for reduced motion. Only the
working state loops, and only while an agent works. Plan: docs/plans/mascot.md. The name, the
motion intensity and the docs-site form are the owner's to choose. The owner approved the plan's
defaults on 2026-11-10: no name in the product, subtle motion, static pictures on the docs site.

## D-68 Project knowledge and the CI fixer extend what exists

Memories already apply per project, and a thread can already watch its pull request. Both grow
instead of being replaced. Memories gain a kind for environment facts, reach every provider, and
can be proposed from a settled thread's corrections; the default is to suggest, because a memory
that saves itself is the path by which text an agent read becomes a standing instruction.
The CI fixer starts the watch by itself for pull requests Moonfold opened and limits attempts
(three by default), stopping to ask when the same failure repeats. It never weakens a test to get
green and never force-pushes. Plan: docs/plans/project-knowledge-ci-fixer.md.

## D-69 Phones reach the computer anywhere through a blind relay

This replaces the last sentence of D-58. The owner wants the phone to work on any network with no
account. Two devices behind address translation cannot always connect directly, so something
reachable by both must carry the bytes. Moonfold's answer is its own small relay that joins two
connections and copies bytes under the pinned TLS session the phone already uses. The relay holds
no key, token or login and cannot read what it carries, so rule 7 holds. It is MIT, in this
repository, and runs as a plain Node server or on Cloudflare Workers' free plan; any user can
point their install at their own. Account-less public tunnels were rejected as a default (their
owners position them for testing, addresses change, a large helper binary). Peer-to-peer by key
is a later transport behind the same seam. The default relay needs a Cloudflare account held by
the project, which is the owner's decision. Plan: docs/plans/anywhere.md.

## D-70 Orbit: always-on work is ordinary threads on a schedule, with the reader kept apart

The always-on mode (working name Orbit) is built from scheduled tasks, threads, worktrees, pull
requests, the CI fixer and provider handoff, not from a second runtime. Its state is files under
`.moonfold/orbit/`, so another agent can continue after a usage limit. The session that reads
public text (issues, Reddit, Hacker News) has no write tools and no secrets, and the session that
builds never sees raw public text, only structured records. Standing orders cannot be changed by a
session that read public content. Budgets, run caps and the stop switch sit outside the model.
The default level is Propose: pull requests and drafts, with merging, releasing and posting one
setting away. Posting to channels that punish automated promotion stays a draft a person sends.
Every run is the user's own CLI with the user's own credentials. Plan: docs/plans/orbit.md.

## D-71 What 1.0 means

The first stable release is 0.1.0-beta.5 plus four features (project knowledge and the CI fixer,
the living mark, Anywhere, Orbit) and a gate: each feature verified against a real provider, the
open items from beta 5 closed, a release dry run on every target, an upgrade test, measured
performance budgets and an accessibility pass. A feature that is not verified ships behind a build
flag or not at all. Plan: docs/plans/stable-1.0.md.

## D-72 The 1.0 features ship first as 1.0.0-rc.1

The owner asked for the first stable release once the four features were built. They are built,
tested and merged, but the parts that run agents (Orbit's crew, the CI fixer, learned memories)
have not run against a real provider: Codex is limited until 19 November and Claude Code is not
signed in on the build machine. CLAUDE.md does not call such work done. So the release is
`1.0.0-rc.1`, which GitHub lists as a prerelease, and `0.1.0-beta.5` stays Latest. Promoting to
`1.0.0` is one tag on the same commit once those runs pass and a default relay is deployed.
D-74 replaces the `-rc` label.

## D-73 The Android app updates itself from GitHub releases

Asked for by the owner on 2026-11-13. The app is not in a store, so it checks this repository's
releases about once a day for the newest `Moonfold-Android-<version>.apk`, downloads it, and
installs it only if its SHA-256 matches the digest GitHub reports for that asset and its signer is
the installed app's own. Android's package installer still asks before replacing the app, and
Android itself refuses a different signer. Only `api.github.com` and GitHub's download host are
contacted, with no identifiers beyond the app version. The daily check can be stopped from the
prompt and restarted from the launcher shortcut. No new dependency (OkHttp and `org.json` were
already there).

## D-74 Testing builds are -beta.N; -rc.N is retired

electron-updater treats any prerelease label other than `alpha` and `beta` as its own channel: a
beta install never sees an `-rc` release, and an `-rc` install never sees a beta or the stable
release. 1.0.0-rc.1 therefore reached nobody through the updater. Its contents ship again as
`1.0.0-beta.6`, which beta 5 installs pick up, and the release workflow now refuses any prerelease
label other than `alpha` or `beta`.

## D-75 The default Anywhere relay is the project's Cloudflare Worker

Deployed on 2026-11-13 to the owner's Cloudflare account at
`wss://moonfold-anywhere-relay.moonfold.workers.dev`, Workers free plan. The account's workers.dev
subdomain was renamed from the owner's email name to `moonfold` (owner's choice) so no personal
identifier ships in the app. A TLS session through it from a test phone to a test computer
completed and the phone saw the computer's own certificate. Users can still enter their own relay.

## D-76 Betas are the Beta update track; Stable and Beta can be switched in Settings

Asked for by the owner on 2026-11-13. Upstream's two tracks were Stable and Nightly, and Moonfold
publishes no nightlies, so the second option could only fail. Moonfold's `-alpha.N` and `-beta.N`
builds now form that second track, shown as Beta; the code keeps upstream's `nightly` name so the
guarded switch (database check, downgrade only inside a switch) is reused unchanged. Beta is
electron-updater's `beta` channel and Stable its latest GitHub release. A beta install stays on
Beta until its user switches. The switch needs each release's database migration, which upstream
read from npm; Moonfold stamps it into the release notes, the one place the releases API exposes
to the app. Once a stable release exists, the workflow publishes betas as prereleases so Stable
never sees them.

## D-77 The Windows installer closes every process running from the install folder

electron-builder decides whether Moonfold is running with a PowerShell `.Count`, which Windows
PowerShell 5.1 leaves empty for a single match. A lone helper started from the app's `.exe`
(agent-device) therefore survived an upgrade, the new `.exe` could not be written, and only the
uninstaller was left, so shortcuts pointed at a missing app (seen on the owner's machine on
2026-11-13). The installer now runs electron-builder's check, which still asks before closing a
running Moonfold, and then force-closes anything left in the install folder.
