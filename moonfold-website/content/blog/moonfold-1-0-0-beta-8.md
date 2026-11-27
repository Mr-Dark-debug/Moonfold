---
title: "Moonfold 1.0.0-beta.8: import chats from Claude Code, Codex, Antigravity and Pi"
description: Beta 8 turns a session you had in another coding agent into a Moonfold thread, with its messages, thinking and tool calls.
category: Releases
date: 2026-11-27
---

Beta 8 adds one feature: bringing in conversations you had with other agents. Beta 7 updates to it by itself, and there are no database changes.

## Import a chat from another agent

Open **Import chat session** from the download button at the top of the sidebar, from a project's menu, or from the command palette. Paste a session ID and select **Find**, or pick a recent session from the list. Moonfold shows what the session holds, and **Import full session** turns it into a thread in the project you chose.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta8-session-import-poster.jpg" src="/assets/demo-beta8-session-import.mp4"></video>

The thread keeps the messages, the thinking and the tool calls, so you can see what the other agent did before you carry on with any provider. It works with Claude Code, Codex, Antigravity and Pi sessions on the computer running Moonfold. Moonfold only reads the original session; it never changes it.

More in [Import a chat from another coding agent](/blog/import-a-chat-from-another-agent/) and the [guide](/docs/import-sessions/).
