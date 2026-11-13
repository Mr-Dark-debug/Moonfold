---
title: Orbit, a crew that keeps working on your project while you are away
description: How Orbit turns public feedback into a ranked backlog and proposed pull requests, and the limits that keep a crew of coding agents in check.
category: Guides
date: 2026-11-13
---

Most coding agents wait for you to type. Orbit is for the time in between: a small crew of agents that keeps working on one project while you are away, and leaves its work for you to review.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta6-orbit-poster.jpg" src="/assets/demo-beta6-orbit.mp4"></video>

## Five roles, one mission

You write the mission once: what the product is, who it is for, what to work towards and what to avoid. Only you can change it. The agents read it but cannot edit it.

| Role     | What it does                                                      |
| -------- | ----------------------------------------------------------------- |
| Scout    | Reads your channels and records what users said, in its own words |
| Planner  | Turns that into a ranked backlog                                  |
| Builder  | Builds the top item with tests and opens a pull request           |
| Sentinel | Checks dependency advisories and security alerts every day        |
| Herald   | Writes release notes and announcement drafts                      |

Each role has its own switch and interval, and **Run now** starts one immediately. Every run is an ordinary Moonfold thread on your own computer, using your own provider sign-in, so you can open it and read exactly what happened.

## How far it goes on its own

- **Observe**: the crew reads and reports, and nothing changes in your code.
- **Propose**, the default: the builder and sentinel open pull requests and the herald writes drafts. You merge, release and post.
- **Ship**: the builder may merge its own pull request once its checks pass and another provider's review approves.
- **Publish**: as Ship, and drafts may also be posted where you allow it. Posting is not built yet, so drafts wait in the inbox at every level.

## Why a post cannot steer the builder

Public feedback is untrusted text, and an agent that reads it should not be the one that changes your code. Orbit keeps those apart. The scout is the only role that reads public posts, and it can only record summaries. The builder sees the planner's backlog, never the posts themselves. Each role's tools check which role is calling, so a scout cannot write the backlog, and no role can change the mission or the settings. The activity log records every change and run and cannot be edited.

**Runs per day** caps how many runs start in a day, so a busy week does not turn into a surprise bill.

## Try it

Open **Orbit** in the sidebar, pick a project, write the mission and add a few Hacker News searches or subreddits under **Where to listen**. Start at Propose and read a few runs before you give it more. The [Orbit guide](/docs/orbit/) covers the rest.
