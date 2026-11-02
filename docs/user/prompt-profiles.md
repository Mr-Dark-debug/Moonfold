# Prompt profiles

A prompt profile is a set of standing instructions Moonfold sends with every turn, to whichever
agent the thread uses. It adds to the agent's own system prompt and to your AGENTS.md or CLAUDE.md;
it never replaces or edits them.

## Choose a profile

- **For everything:** **Settings → Prompt Profiles → Default prompt profile**. Pick a project in
  the settings scope to give that project its own default.
- **For one thread:** open the thread menu, choose **Prompt profile**, and pick one. **Default**
  goes back to the project's or environment's default.

The built-in profiles:

| Profile          | What it asks for                                                               |
| ---------------- | ------------------------------------------------------------------------------ |
| Moonfold default | Nothing. Each agent works the way its own harness tells it to.                 |
| Careful engineer | Small, reviewable changes; run the narrowest checks and report real results.   |
| Terminal-first   | Inspect with commands, edit with small patches, verify by running things.      |
| Pair programmer  | Explain the plan and trade-offs, point out risks, check in before large moves. |
| Minimal          | Short answers and only the changes asked for.                                  |

## Write your own

In **Settings → Prompt Profiles**, choose **New profile**, give it a name and write the
instructions (up to 16,000 characters). Your profiles belong to the environment, so every project on
it can use them. Deleting a profile sends the threads that used it back to the default.

## Good to know

- A profile chosen in the middle of a thread reaches the agent with your next message. Claude Code
  and Pi receive it as a short note in front of that message, because they keep the system prompt
  their session started with.
- A handoff keeps the thread's profile, so the next agent works under the same instructions.
- Slash commands (messages that start with `/`) are sent unchanged.

## Agent limits

**Settings → Prompt Profiles → Agent limits** has two more guardrails. Both can differ per project.

**Content exclusions** are paths agents must leave alone, one per line, relative to the project,
such as `.env` or `secrets/**`. Claude Code's file tools are blocked from them. Other agents receive
them as an instruction, and any agent's shell commands can still reach them, so keep real secrets
out of the project.

**Token limit for one run** stops a run once it has added that many tokens to its context, and holds
queued messages. Send a message to continue; each message starts with a fresh allowance. It counts
what Codex and Claude report during a turn, and agents that report no usage are not limited.
