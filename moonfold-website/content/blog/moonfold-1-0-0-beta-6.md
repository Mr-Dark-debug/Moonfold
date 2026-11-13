---
title: "Moonfold 1.0.0-beta.6: Orbit, your phone on any network, and self-fixing pull requests"
description: Beta 6 adds Orbit, a crew that keeps working on your project, lets the Android app reach your computer from anywhere, and fixes failing pull request checks.
category: Releases
date: 2026-11-13
---

Beta 6 brings everything from the 1.0 release candidate to the beta line. Beta 5 updates to it by itself, and two database migrations run on first start. Nothing else changes until you turn a feature on.

## Orbit

Orbit is a crew of agents that keeps working on one project while you are away. A scout reads what people say on GitHub, Hacker News, subreddits and feeds. A planner ranks a backlog, a builder builds the top item and opens a pull request, a sentinel checks security every day, and a herald drafts release notes. You write the mission, choose how far the crew may go on its own, and cap its runs per day. It starts at **Propose**, so nothing merges without you.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta6-orbit-poster.jpg" src="/assets/demo-beta6-orbit.mp4"></video>

The video shows setting it up. A crew run uses your own provider sign-in, so it is not in the recording. More in [Orbit, a crew that keeps working while you are away](/blog/orbit-a-crew-that-keeps-working/) and the [Orbit guide](/docs/orbit/).

## The Android app updates itself

Moonfold for Android 0.3.0-beta.1 checks for new versions about once a day and installs them after you agree. It only installs a build whose checksum matches the release and that is signed with the same key. Install 0.3 by hand once; after that it updates itself.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta6-android-updates-poster.jpg" src="/assets/demo-beta6-android-updates.mp4"></video>

More in [Moonfold for Android now updates itself](/blog/moonfold-android-updates-itself/).

## Your phone, on any network

The Android app now reaches your computer on mobile data or any other network, with no account. A relay passes the connection along, and it stays encrypted end to end, so the relay never sees what you do. Turn it on in **Settings → Mobile App** and scan a new code, or run your own relay with `moonfold relay`. See [Reaching your computer](/docs/mobile-app/#reaching-your-computer).

## Pull requests that fix their own checks

A pull request you create from a thread is watched for you. When a check fails, the agent reads the failure and pushes a fix, up to three tries, and never by weakening a test. Change the number in **Settings → Source Control**. See [Fix failing checks](/docs/source-control/#fix-failing-checks).

## Agents learn from your corrections

When you correct how an agent works in a project, it can note that for next time. The note waits as a suggestion in **Settings → Memories** until you accept it. See [Memories](/docs/memories/).

## Not verified yet

A full Orbit crew run, the CI fixer on a real failing check and a saved correction all need a provider sign-in this build was not tested with. If you try them, we would like to hear how it went.
