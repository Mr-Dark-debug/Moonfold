---
title: "Moonfold 1.0.0-beta.7: safer Windows upgrades, settings that stay put, Stable or Beta"
description: Beta 7 fixes Windows upgrades that left Moonfold missing, stops seven settings pages from crashing, and lets you choose Stable or Beta updates.
category: Releases
date: 2026-11-13
---

Beta 7 is a fix release with one new setting. Beta 6 updates to it by itself, and there are no database changes.

## Windows upgrades no longer leave Moonfold missing

If a Moonfold helper was still running in the background, an upgrade could remove the app and then fail to write the new one. Windows then said it was "searching for Moonfold (Beta).exe". The installer now closes every process running from the install folder first. If this happened to you, run the beta 7 installer over it; your projects, threads and settings are kept. The full story is in [Windows is searching for an .exe after an update](/blog/windows-searching-for-exe-after-update/).

## Settings pages no longer crash

Memories, Mobile app, Plugins, Handoff, Computer use, Personalization and Prompt profiles opened full-window and failed with "Something went wrong". They now open in the settings panel like every other page.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta7-settings-panel-poster.jpg" src="/assets/demo-beta7-settings-panel.mp4"></video>

## Stable or Beta

**Settings → About → Update track** chooses between Stable releases and Beta builds, which get new features first. Switching installs the newest build of that track in place and keeps your data. There is no Stable release yet, so for now everyone is on Beta, and choosing Stable tells you so. See [Switch between Stable and Beta](/docs/updating/#switch-between-stable-and-beta).
