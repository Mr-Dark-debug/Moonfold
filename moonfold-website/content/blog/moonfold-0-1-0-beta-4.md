---
title: "Moonfold 0.1.0-beta.4: your agents on your phone, with no account"
description: Beta 4 adds Moonfold for Android, paired with one QR scan over an encrypted connection to your own computer, plus content exclusions and a token limit for one run.
category: Releases
date: 2026-11-02
---

Agents keep working when you step away from your desk. Beta 4 lets you go with them: Moonfold for Android shows the Moonfold running on your computer, and there is no account anywhere in the middle.

## Moonfold for Android

Turn it on in **Settings → Mobile App**, open the app and scan the code. That is the whole setup. Close and reopen the app as often as you like; while Moonfold runs on your computer, the phone connects by itself. If your computer sleeps, the app waits and reconnects when it returns. The app is a beta, installed from the APK on the [releases page](https://github.com/Mr-Dark-debug/Moonfold/releases). The [mobile app guide](/docs/mobile-app/) covers setup.

## Encrypted, with nothing in between

The connection runs straight from your phone to your computer. The code you scan tells the phone exactly which computer to trust, so nobody on the network can read the connection or pose as your computer, and no service, domain or certificate authority is involved. Paired phones are listed in **Settings → Connections**, where you can revoke one in a click.

Because nothing sits in between, the phone needs a network it shares with your computer: the same Wi-Fi at home, or [Tailscale](/docs/remote-access/) or a VPN when you are out.

## Content exclusions

List the paths agents should leave alone, per project, in **Settings → Prompt Profiles → Agent limits**. Claude Code's file tools are blocked from them outright. Other agents receive them as an instruction, and any agent's shell commands can still reach them, so this keeps agents out of the way of private files rather than protecting real secrets. Those still belong outside the project.

## A token limit for one run

Set a limit next to it, and a run stops once it has added that many tokens to its context. Send a message and it carries on with a fresh allowance, so a runaway task stops without locking the thread. It counts what Codex and Claude report during a turn. See [Agent limits](/docs/prompt-profiles/#agent-limits).

## Also fixed

The dark theme rendered blue on older Chromium browsers and Android web views. It now looks right everywhere.
