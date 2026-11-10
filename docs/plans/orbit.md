# Orbit: a crew that keeps working on your product

Status: plan. Decision: D-70. "Orbit" is a working name; the owner can rename it.

## What the owner asked for

A mode where Moonfold works on a product around the clock without being asked: it reads what
users say (GitHub, Reddit, Hacker News, social channels), decides what to build, builds and tests
it, releases it, checks security every day, and tells the world. The screen changes too: one
prompt in the middle and the agents down the side.

## What others ship (public sources, late 2026, in our words)

- **Always-on personal agents** from the large labs (Grok Bot, OpenAI's Dots, Meta's Muse): named
  agents on a cloud computer that run routines on a schedule and keep going with the laptop shut.
  What stops them: per-action approval, a review check on actions that touch accounts, usage
  limits. Proactive work runs with read-only connections.
- **Self-hosted always-on agents** (OpenClaw, Hermes Agent): a scheduled "proactive check" in a
  fresh session, standing orders in a file, quiet runs that report nothing.
- **Coding products** (Codex scheduled tasks, Cursor automations, Devin, Jules' suggested tasks):
  schedules and event triggers, a worktree per run, results in an inbox with unread state.
- **"Run my company" tools** (Paperclip and similar): an org chart of agents, a goal chain, a
  monthly budget per agent that pauses it at 100 percent, approval before hiring, an append-only
  history.

Reported failures, all worth designing against: bills of thousands from agents looping overnight;
an agent deleting a production database; a web page planting instructions into a standing-orders
file that then re-ran every half hour; an issue title steering a triage agent into a poisoned
package release.

## How much is possible

| Wish                                       | Verdict                                                                     | Notes                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Run day and night                          | Yes, while the computer is on and awake, or on a server with `npx moonfold` | Usage limits are the real ceiling; provider handoff is what keeps it going                                                     |
| Read GitHub issues, discussions, alerts    | Yes                                                                         | The user's own `gh` login                                                                                                      |
| Read Hacker News                           | Yes                                                                         | Public search API, no key                                                                                                      |
| Read Reddit                                | Yes, with the user's own Reddit app                                         | Free for non-commercial use, about 100 requests a minute, app approval required; commercial use needs an agreement with Reddit |
| Read X, Instagram, LinkedIn                | Limited                                                                     | Paid or review-gated APIs; only through a connector the user sets up                                                           |
| Read feeds, changelogs, review pages       | Yes                                                                         | RSS and Atom                                                                                                                   |
| Pick, build, test features                 | Yes                                                                         | Threads, worktrees, pull requests, the CI fixer                                                                                |
| Release                                    | Yes                                                                         | The project's own release command, behind a setting                                                                            |
| Daily security check and fixes             | Yes                                                                         | Dependency audit, secret scan, host alerts; fixes arrive as pull requests                                                      |
| Post announcements on GitHub               | Yes                                                                         | Releases and discussions                                                                                                       |
| Post on Bluesky, Mastodon                  | Yes                                                                         | Open APIs, the user's own token                                                                                                |
| Post on Reddit, X, Instagram, LinkedIn, HN | Drafts                                                                      | Automated promotion is how accounts get banned, and HN has no posting API. Orbit writes the post; a person sends it            |
| No human at all, ever                      | Not by default                                                              | Possible to switch on per action class, with hard stops outside the model                                                      |

## The screen

A switch at the top of the sidebar: **Workspace** (today's app) and **Orbit**.

- **Left rail:** the crew, one row per role with its living-mark state (working, waiting, done,
  attention), last run and next run. Below it: Inbox, Backlog, Settings.
- **Centre:** one prompt. What you type becomes or edits the **mission** (the standing order), or
  a one-off request to the crew. Under it, today's digest: what shipped, what is waiting, what was
  skipped and why.
- **Right panel:** the selected item: a finding, a pull request, a draft post, a run's trace.

The Inbox shows findings only. Runs with nothing to report are filed without a notification.
Anything that needs the user is a question card, as in a thread.

## The crew

Roles are prompt profiles plus a schedule, not new machinery. Each run is an ordinary Moonfold
thread in its own worktree, so everything a thread has (review, diffs, handoff, usage limits)
applies.

| Role     | Does                                                           | Can write                           |
| -------- | -------------------------------------------------------------- | ----------------------------------- |
| Scout    | Reads channels, turns posts and issues into structured signals | Nothing. No secrets, no write tools |
| Planner  | Scores signals against the mission, keeps the backlog          | The backlog file only               |
| Builder  | Implements one backlog item with tests                         | Its own branch, pull requests       |
| Reviewer | Reviews the Builder's change, from a different provider        | Review comments                     |
| Sentinel | Daily security check, opens fix pull requests                  | Its own branch, pull requests       |
| Herald   | Release notes, changelog, announcement drafts                  | Drafts; posts where allowed         |

## The loop

1. **Listen.** Scout runs on a schedule. Each post becomes a record: source, link, kind
   (bug, request, praise, question), a one-line summary in the Scout's own words, a short quoted
   excerpt, a count of similar reports.
2. **Decide.** Planner merges duplicates, scores by reach, fit with the mission and effort, and
   writes the ordered backlog. Items above the "needs the owner" line (new dependencies, pricing,
   data deletion, anything legal) become questions, not work.
3. **Build.** Builder takes the top item into a worktree, writes the change and tests, opens a
   pull request. The CI fixer keeps it green.
4. **Review.** Reviewer scores it. Below the bar, it goes back with fixes, a limited number of
   times.
5. **Ship.** According to the autonomy level: wait for the user, or merge when checks pass and the
   review is clean. Releases follow the project's cadence setting.
6. **Tell.** Herald writes notes and announcements; posts or queues them.
7. **Guard.** Sentinel runs daily regardless of the rest.
8. **Report.** One digest a day.

State is files in the project under `.moonfold/orbit/` (mission, backlog, signals, digests), so a
different agent can pick it up after a usage limit, plus an append-only audit log in the database.

## Autonomy levels

| Level             | Orbit may                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------- |
| Observe           | Read, score, write the digest                                                                  |
| Propose (default) | Also open pull requests and write drafts. A person merges, releases and posts                  |
| Ship              | Also merge its own pull requests when checks pass and review is clean, and release on schedule |
| Publish           | Also post on channels marked as allowed for automatic posting                                  |

Each outward action class (merge, release, post per channel) has its own switch inside the level,
so "Ship but never post" is one click.

## Safety, built in from the start

- **Reader and actor are separate sessions.** The Scout reads public text and has no write tools
  or secrets. The Builder never sees raw public text, only the structured records. No session
  combines untrusted input, access to secrets and the ability to change things.
- **Standing orders are protected.** The mission, schedules, roles and memories cannot be written
  by a session that touched public content. Changes to them show as a diff for the user.
- **Hard stops outside the model:** a run cap per day, the per-run token limit (D-60), a daily
  token cap per role that pauses it, a retry cap, quiet hours, and a stop button the crew cannot
  reach.
- **Branch safety:** worktree per run, pull requests only, required checks, no force-push, never
  the default branch directly. Dependency updates wait a cooling-off period and get a lockfile
  review.
- **Posting:** official APIs only, with the user's own account, and a visible note that the post
  was written with an agent where the channel expects it.
- **Everything is logged** and the digest links to each run.
- Nothing here pools or shares anyone's provider login. Every run is the user's own CLI.

## Connectors

Version one, all on the user's machine with the user's own credentials:

| Connector   | Read                                                            | Post                            | Credentials               |
| ----------- | --------------------------------------------------------------- | ------------------------------- | ------------------------- |
| GitHub      | Issues, discussions, alerts, reviews                            | Releases, discussions, comments | `gh` login                |
| Hacker News | Search and threads                                              | No (no API)                     | None                      |
| Feeds       | RSS, Atom                                                       | No                              | None                      |
| Reddit      | Subreddits, search                                              | Draft only                      | The user's own Reddit app |
| Bluesky     | Mentions, search                                                | Yes, if switched on             | App password              |
| Mastodon    | Mentions, hashtags                                              | Yes, if switched on             | Access token              |
| Webhook in  | Anything that can call a URL (existing scheduled-task webhooks) | No                              | Secret                    |

X, Instagram, Threads, LinkedIn, app-store reviews and others come through MCP servers the user
adds; Orbit treats any MCP source as untrusted reader input. Each bundled or recommended server
goes through the REA gate first.

Sentinel's tools: the package manager's audit, a secret scanner and a vulnerability scanner with
permissive licences (to be licence-checked before bundling; none is bundled without it), and the
host's dependency and code-scanning alerts through `gh`.

## Requirements

- A computer or server that stays on. A keep-awake option; a clear "paused: computer was asleep"
  line in the digest.
- At least two providers signed in, for handoff and for an independent reviewer. With one, Orbit
  says the review is weaker.
- A repository with a pull-request flow and checks.
- The user's own credentials for each channel.

## Build order

1. Contracts, the `.moonfold/orbit/` files, the audit log, budgets and the stop switch.
2. Crew profiles and the scheduler wiring on top of scheduled tasks; Observe level end to end with
   GitHub, Hacker News and feeds.
3. The Orbit screen: rail, prompt, inbox, digest.
4. Planner and backlog; Propose level: Builder, Reviewer, CI fixer.
5. Sentinel.
6. Herald, drafts, GitHub posting; Reddit read; Bluesky and Mastodon.
7. Ship and Publish levels with their switches.
8. Docs, evals for every crew prompt, a one-week unattended run on a real repository with the
   results in `docs/QA-ORBIT.md`.

## Hit every surface

Web and desktop get the Orbit screen; the phone gets it through the web client. Every action is a
service method, so MCP tools and scheduled tasks reach the same paths. Each level has a way back.
Works over remote connections. Provider differences are handled by the thread layer already.

## Open decisions for the owner

1. The name: Orbit, or another.
2. The default level: Propose is recommended. The owner asked for no interruptions; Ship and
   Publish are there, one setting away, once Propose has run cleanly for a while.
3. Which channels matter first after GitHub, Hacker News and Reddit.
