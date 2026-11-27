---
title: Import a chat from another coding agent
description: How to bring a Claude Code, Codex, Antigravity or Pi session into Moonfold by its ID, what comes across, and where to find the ID.
category: Guides
date: 2026-11-27
---

You started a task in one coding agent, and now you want it in Moonfold: to read it next to your other threads, or to carry on with a different provider. Moonfold 1.0.0-beta.8 can import that conversation.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta8-session-import-poster.jpg" src="/assets/demo-beta8-session-import.mp4"></video>

## By ID or from a list

Open **Import chat session** from the download button at the top of the sidebar. The dialog lists recent sessions it finds on the computer, newest first. Filter them by provider or by text, or limit them to the folder of the project you picked.

If you know the session, paste its ID and select **Find**. Moonfold looks through every provider, or only the one you choose, and shows the session's title, model, message count and tool-call count before anything is imported.

## What comes across

The thread gets the user and assistant messages, the thinking, and the tool calls: commands, file edits and searches. A session that is already in Moonfold opens its existing thread instead of making a copy. Very long sessions are cut at 2,000 items, and the thread says how many older items were left out.

Moonfold only reads the original files. Your Claude Code, Codex, Antigravity or Pi history stays exactly as it was.

## Where the ID lives

| Provider    | Location                                             |
| ----------- | ---------------------------------------------------- |
| Claude Code | `~/.claude/projects/<folder>/<id>.jsonl`             |
| Codex       | `~/.codex/sessions/<date>/rollout-<time>-<id>.jsonl` |
| Antigravity | `~/.gemini/antigravity/brain/<id>/`                  |
| Pi          | `~/.pi/agent/sessions/`                              |

Sessions are read from the computer running Moonfold. From a phone or a browser on another device, you see the sessions on that computer. The [guide](/docs/import-sessions/) has the details.
