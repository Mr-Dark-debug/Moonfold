# Import chat sessions

Bring a conversation you had in Claude Code, Codex, Antigravity or Pi into Moonfold as a thread.
The thread keeps the messages, the thinking and the tool calls, and you can carry on from there with
any provider.

## Import a session

Open **Import chat session** from the download button at the top of the sidebar, from a project's
menu, or from the command palette. Then either:

- **Paste a session ID** and select **Find**. Moonfold checks every provider, or only the one you
  pick, and shows the session with its message and tool-call counts. Select **Import full
  session**.
- **Pick a recent session** from the list below. Filter it by provider, by text, or by
  **This project only** to see sessions that ran in the chosen project's folder.

The thread goes into the project shown at the top of the dialog. Importing a session that is
already in Moonfold opens the existing thread instead of making a copy.

## Where to find a session ID

Each provider names its session files after the ID:

| Provider    | Location                                                                             |
| ----------- | ------------------------------------------------------------------------------------ |
| Claude Code | `~/.claude/projects/<folder>/<id>.jsonl`                                             |
| Codex       | `~/.codex/sessions/<year>/<month>/<day>/rollout-<time>-<id>.jsonl`, sometimes `.zst` |
| Antigravity | `~/.gemini/antigravity/brain/<id>/`                                                  |
| Pi          | `~/.pi/agent/sessions/`                                                              |

If you set a different home for a provider in its settings, or with `CLAUDE_CONFIG_DIR`,
`CODEX_HOME` or `PI_CODING_AGENT_DIR`, Moonfold looks there.

## Good to know

- Moonfold only reads the original session. It never changes or deletes it.
- Sessions are read from the computer running the environment. From a phone or another browser,
  you see the sessions on that computer, not on the device in your hand.
- A very long session is cut at 2,000 items. The thread says how many older items were left out.
