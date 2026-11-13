---
title: "Windows is searching for an .exe after an update: why it happens and how we fixed it"
description: A Windows shortcut that searches for a missing .exe after an app update usually means the installer could not replace a running file. Here is the cause and the fix.
category: Guides
date: 2026-11-13
---

You update an app, click its shortcut, and Windows shows "Missing Shortcut: Windows is searching for App.exe". The app folder holds only the uninstaller. This happened to Moonfold users upgrading on Windows, and the cause is common to any Electron app built with an NSIS installer.

## The short answer

The installer removed the old app but could not write the new `.exe`, because a process started from that `.exe` was still running. Windows will not overwrite a file that is in use. Closing every process that runs from the install folder before installing fixes it. If you hit this with Moonfold, install [1.0.0-beta.7 or later](https://github.com/Mr-Dark-debug/Moonfold/releases) over it; your projects, threads and settings are kept.

## Why the running app was not noticed

Installers made with electron-builder check whether the app is running before they upgrade, and ask you to close it. The check counts matching processes with a PowerShell expression of the form `(...).Count -gt 0`. On Windows PowerShell 5.1, a query that finds exactly one process returns a single object rather than a list, and that object has no usable `Count`. One running process was therefore counted as none.

Moonfold starts a small helper from its own `.exe` for some background work. When that helper was the only process left, the installer believed nothing was running, deleted the old files, failed to write the new `.exe` over the locked one, and finished anyway. The Start menu shortcut now pointed at a file that no longer existed.

## The fix

Moonfold's installer still runs electron-builder's check, so it still asks before closing a running Moonfold. Then it closes every process whose path is inside the install folder, wrapping the query in `@(...)` so one result is still a list. We reproduced the failure with exactly one helper running: the old installer left it alive and broke the install, and the new one closed it and installed cleanly.

## If you ship an Electron app

If your app starts child processes from its own executable, test an upgrade with exactly one of them running. Wrapping PowerShell results in `@(...)` before reading `.Count` avoids this whole class of bug.
