# Memories

Memories are short notes that agents receive at the start of every turn, so you don't have to
repeat a preference in each conversation. Manage them in **Settings → Memories**. Each environment
keeps its own memories on its own machine.

## Add a memory

Choose **Add memory**, write it in a sentence or two, and pick where it applies: all projects, or
one project. You can also tell an agent "remember that…" in a thread; it saves the memory itself
for that thread's project, and Settings shows it as **Saved by an agent** with a link to the thread
it came from. To make it apply everywhere, edit it there.

What you write is treated as your own instruction. A memory an agent saved is passed on as
background information instead, so an agent misled by something it read cannot turn that into an
instruction for later turns. Editing an agent's memory makes it yours.

A memory is a **Preference** (how you like things done) or a **Setup fact** (a command or a
requirement of the project, such as how its tests run). Pick the kind when you add or edit one.

Text that looks like a password, key or token is refused. Memories are sent to agents on every
turn, so keep secrets out of them.

## Learn from corrections

When you correct how an agent works in a project ("use pnpm here", "tests live beside the file"),
it can note that for next time without being asked. **Learn from corrections** in Settings →
Memories decides what happens to such a note:

- **Suggest** (the default): the note waits at the top of the list as a **Suggestion**. Accept it
  and it becomes your own memory; dismiss it and it is gone. Until you accept it, no agent
  receives it.
- **Automatic**: the note is saved at once as an agent's memory, which later turns treat as
  background information, never as an instruction.
- **Off**: agents save only what you ask them to remember.

## Turn memories off

**Use memories** turns them off for the whole environment: agents receive none and cannot save
new ones. To leave them out of one thread, open the thread's menu and choose **Memories → Don't use
memories**; choose **Use memories** to bring them back.

## Which agents use memories

Codex, Claude Code, Cursor, OpenCode, Muse Code and agents connected through ACP receive memories.
Pi does not yet. A change applies from the next turn.

If you turned on Codex's own memories in its configuration, Codex may keep what you ask it to
remember in its own memory instead, where other providers don't see it. Say "remember this in
Moonfold" to save it here.
