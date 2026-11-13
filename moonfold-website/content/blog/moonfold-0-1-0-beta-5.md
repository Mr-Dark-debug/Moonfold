---
title: "Moonfold 0.1.0-beta.5: a redesigned workspace and home screen artwork"
description: Beta 5 brings a redesigned thread and composer, artwork behind the new thread screen, brand kits with /brand, question cards and better review tools.
category: Releases
date: 2026-11-10
---

Beta 5 is the biggest update so far. It brings in about six weeks of upstream work, including a full redesign of the workspace, and adds a few things of our own on top.

## A redesigned thread

The new look is now the only design. The composer is simpler, with grouped controls and one control for the model and its effort. While an agent works, its plan, each tool call and every approval stream into the thread, and you choose what the thread details card on the right shows. Settings and Usage open as large panels over your thread, F6 moves between areas of the workspace, and the sidebar works from the keyboard.

This video replays a recorded agent turn through the real app, so it costs nothing to run. You can see the plan, a file read, an approval and the test run:

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta5-agent-turn-poster.jpg" src="/assets/demo-beta5-agent-turn.mp4"></video>

## Artwork behind the new thread screen

Open **Settings → Appearance → Home screen** and choose Moonfold, Golden hour or Purple wind. Draw it as ASCII text, which follows your theme, or as the bundled image. **Classic (no image)** stays the default, so nothing changes until you pick one, and the choice is saved per device. See [Home screen background](/docs/appearance/#home-screen-background).

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta5-home-backgrounds-poster.jpg" src="/assets/demo-beta5-home-backgrounds.mp4"></video>

## Brand kits with /brand

Start a message with `/brand` and describe what you are building. The agent asks about the brief, explores two to five directions, shows each one as a picture and saves the kit in your project: name, logos, colours for light and dark, type, voice, exports for CSS, Tailwind, SCSS, TypeScript and JSON, and a brand book page. Nothing in your code changes unless you say yes. See [Brand kits](/docs/brand-kits/).

## Question cards

Agents with Moonfold's tools can stop and ask you in the thread, with pictures on the options, and carry on when you answer.

## Review and files

Review local commits in the Diff pane, open a tool call's diff there, and mark pull request files as viewed with shift-click. Pull request comments appear in the chat. The file viewer previews Office files, OpenDocument, EPUB, notebooks, archives, SQLite databases, fonts and Mermaid diagrams.

## Good to know

`/brand` and question cards are covered by automated tests but had not been run against a live provider when beta 5 shipped, so tell us what you find. The installers are not signed yet. Beta 3 and later update themselves; the [releases page](https://github.com/Mr-Dark-debug/Moonfold/releases/tag/v0.1.0-beta.5) has everything else.
