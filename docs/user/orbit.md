# Orbit

Orbit is a crew of agents that keeps working on one of your projects while you are away. It listens
to what people say about the project, turns that into a ranked backlog, builds the top item and
opens a pull request, checks security every day, and drafts announcements. Open it from **Orbit** in
the sidebar and pick the project at the top.

Every run is an ordinary Moonfold thread on your own computer, with your own provider sign-ins. The
crew runs only while Moonfold is running.

## Start

1. Choose a default model for the project in its settings; the crew runs on it.
2. Write the **Mission**: what the product is, who it is for, what to work towards and what to
   avoid. Only you can change it. Agents read it but cannot edit it.
3. Under **Where to listen**, keep GitHub issues on and add Hacker News searches, subreddits or
   feeds if you like.
4. Turn Orbit on.

Use **Ask the crew** to put your own request at the top of the backlog. **Stop all** pauses every
role at once.

## The crew

| Role     | What it does                                                      |
| -------- | ----------------------------------------------------------------- |
| Scout    | Reads your channels and records what users said, in its own words |
| Planner  | Turns that into a ranked backlog                                  |
| Builder  | Builds the top item with tests and opens a pull request           |
| Sentinel | Checks dependency advisories and security alerts every day        |
| Herald   | Writes release notes and announcement drafts                      |

Each role has its own switch and its own interval. Each role's mark shows its state: the star
circles while it works, a hollow star and level ring mean its last run failed, and two dots mean
Orbit is waiting (paused, out of budget, or missing something). Roles are also listed in
**Settings → Scheduled Tasks**, where you can see every run.

## Autonomy

- **Observe**: the crew reads and reports. Nothing changes in your code.
- **Propose** (the default): the builder and sentinel open pull requests, and the herald writes
  drafts. You merge, release and post.
- **Ship**: the builder may also merge its own pull request once its checks pass and another
  provider's review approves.
- **Publish**: as Ship; drafts may also be posted where you allow it. Posting is not built yet, so
  drafts wait in the inbox at every level.

Pull requests the crew opens get the [CI fixer](./source-control.md#fix-failing-checks), so failing
checks are fixed before you look.

## The inbox

Reports, questions and drafts wait in the inbox. Runs that found nothing are filed without bothering
you. A **Needs you** item is a decision the planner left to you: anything that adds a dependency,
changes pricing or licences, deletes user data or has legal weight. **Open run** shows the thread
the work happened in.

## Limits and safety

- **Runs per day** caps how many runs start in a day (UTC). When it is reached, every role waits
  until the next day.
- The scout is the only role that reads public posts, and it can only record summaries. The
  builder sees the planner's backlog, never the posts themselves, so a post cannot instruct the
  agent that changes your code.
- Each role's tools check which role is calling: a scout cannot write the backlog, and no role can
  change the mission or settings.
- The **Activity log** lists every settings change, run and record, and cannot be edited.

Reddit and Hacker News are read through their public feeds and search. Automated posting to
Reddit, X, LinkedIn or Hacker News breaks those sites' rules, so drafts for them are always yours
to send.
