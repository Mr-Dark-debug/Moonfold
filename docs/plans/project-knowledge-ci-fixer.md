# Project knowledge and the CI fixer

Status: plan. Decision: D-68.

Two features users of Google's Jules know: the agent remembers how a repository likes things done,
and it repairs its own pull request when checks fail. Moonfold has most of the machinery already.

## What others do (public docs, in our words)

- **Jules, Memory:** learns from interactions on a repository and reuses that on the next similar
  task there. Per repository, with an on/off switch in the repository's settings.
- **Jules, CI Fixer:** when a GitHub Actions check fails on a pull request Jules opened, it reads
  the failure, pushes a fix and repeats. A project setting; third-party reviews mention an attempt
  limit (not confirmed in Google's own pages).
- Secondary sources say Jules is winding down at the end of 2026 (not confirmed). The two ideas
  stand on their own either way.

## What Moonfold already has

- **Memories** (`apps/server/src/memories/MemoryStore.ts`, [user guide](../user/memories.md)):
  notes for all projects or one project, written by the user or saved by an agent on request.
  Agent-saved memories reach later turns as background, not as instructions. Only Codex and Claude
  Code turns receive them.
- **Pull request watch** (`PullRequestWatchReactor.ts`, the `watch_pull_request` tool): a thread
  that watches its pull request is woken on failed checks, passed checks, comments and conflicts.
  The agent has to ask for the watch, and nothing limits how often it tries.

## Project knowledge

1. **Learning without being asked.** The agent itself proposes a memory through the `remember`
   tool, marked as learned, when the user corrects how it works. **Learn from corrections** in
   Settings → Memories picks what happens: **Off**; **Suggest** (default), where the note waits
   as a suggestion that reaches no turn until the user accepts it; or **Automatic**, saved as an
   agent memory, which stays background information. (As built: no separate model pass after the
   thread. That keeps it free of extra usage and working with every provider that has Moonfold's
   tools. The setting is per environment, beside "Use memories", not per project.)
2. **Environment notes.** A second kind of memory for facts about running the project: the
   install, test and lint commands that worked, the Node version, a service that must be running.
   Shown in their own group, so preferences and setup facts do not mix.
3. **Every provider.** Memories travel with the prompt profile path that already reaches every
   adapter (D-59), so providers other than Codex and Claude Code receive them too.
4. **Hygiene.** A memory records the thread it came from. Text that looks like a secret is
   refused. Turns keep their existing size cap. (Not built: a last-used time and sorting by it.)

## CI fixer

A project setting, **Fix failing checks**, holds the number of tries: Off, or 1 to 10, three by
default. (As built: one setting instead of the three-way choice first planned. It covers pull
requests Moonfold opened; a watch the agent starts itself gets the same limit.)

- When a thread opens a pull request through Moonfold, the watch starts by itself.
- On failed checks the thread is woken, as today, with the failing jobs. The message carries the
  try number and the rules below.
- After the last try the watch ends and the agent is told to stop pushing, report what still fails
  and what it tried, and ask. A pass resets the count, and so does watching again.
- Rules sent with every wake: fix the cause, never delete or weaken a test or a check to get
  green, never force-push, push only to the pull request's own branch. A failure in a job the
  change did not touch is rerun once before any code changes, to catch flaky checks.
- A usage limit during a fix hands the thread to the next agent like any other turn.
- Works wherever the watch works: GitHub first, the other source-control hosts as their check
  results are available.

## Hit every surface

- **Entry points:** project settings, Settings → Memories, the thread menu, the pull request panel
  (a "Fixing checks: attempt 2 of 3" line), MCP tools so an agent or a scheduled task can read the
  state.
- **Clients:** web and desktop; the phone shows the web client.
- **Providers:** one decision per adapter for memory delivery; the fixer is provider-neutral.
- **Reverse states:** every suggestion can be dismissed, every memory deleted, the fixer stopped
  from the pull request panel, the watch removed.
- **Contracts:** memory kind, suggestion records, fixer settings and attempt state.
- **Docs:** `docs/user/memories.md`, `docs/user/source-control.md`, `docs/user/project-settings.md`.

## Tests

Event-sourced tests for the attempt counter, the repeat-failure stop, the flaky rerun and the
automatic watch; store tests for kinds, caps and secret refusal; an eval for the suggestion prompt
(evals/README.md) with cases that must produce no suggestion.

## Order of work

1. Contracts and migration for memory kind, last-used time and suggestions.
2. Delivery to every provider.
3. Suggestion pass, its setting and its UI.
4. Fixer: automatic watch, attempt state, wake message, stop conditions, panel line.
5. Docs, evals, one live run on a real pull request with a deliberately failing check.
