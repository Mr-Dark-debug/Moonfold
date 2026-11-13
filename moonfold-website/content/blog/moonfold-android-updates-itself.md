---
title: Moonfold for Android now updates itself
description: From 0.3, the Moonfold Android app finds new releases on GitHub, checks the checksum and signing key, and installs the update after you agree.
category: Guides
date: 2026-11-13
---

Moonfold for Android is installed from an APK on the releases page, not from an app store. Until now that meant downloading and installing every new version by hand. From 0.3.0-beta.1 the app does it for you.

<video controls preload="metadata" playsinline width="1440" height="810" poster="/assets/demo-beta6-android-updates-poster.jpg" src="/assets/demo-beta6-android-updates.mp4"></video>

The video was recorded on an Android emulator: an older build finds 0.3.0-beta.1 on the releases page and installs it in place.

## How it works

About once a day the app checks Moonfold's GitHub releases for a newer Android build and offers it. Tap **Update** and it downloads the APK. The first time, Android asks you to let Moonfold install updates; turn on **Allow from this source**, come back, and the update continues. Android asks once more before replacing the app, and your pairing is kept.

## What it checks before installing

An update is installed only if its checksum matches the one GitHub publishes for the release and it is signed with the same key as the app you already have. A tampered or re-signed APK is refused.

## Checking now, or not at all

Long-press the Moonfold icon and choose **Check for updates** to check right away. **Stop checking** in the update prompt turns the daily check off, and **Check for updates** turns it back on.

Versions before 0.3 cannot update themselves, so install 0.3 from the [releases page](https://github.com/Mr-Dark-debug/Moonfold/releases) once. The [mobile app guide](/docs/mobile-app/#updates) has the details.
