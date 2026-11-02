# REA gate: Moonfold for Android beta 1

Date: 2026-11-02. Tool: REA MCP (`open_binary`, `inspect_artifact`), plus `aapt dump badging` and a
string scan of the unpacked APK. Static analysis only: nothing was executed by REA.

Target: `app-release.apk`, the signed release build, 478 KB. Evidence `ev_d9ac05c4cb3b8157…`.

## Observations

- 96 archive entries, 88 distinct nodes, 0 integrity contradictions, complete inventory.
- Package `dev.moonfold.mobile`, version `0.1.0-beta.1`, minimum SDK 26, target SDK 36.
- Permissions: `INTERNET`, `ACCESS_NETWORK_STATE`, `CAMERA`, and the system-generated
  `DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`. No storage, location, contacts or notification
  permission.
- No native libraries. One `classes.dex` of 388 KB.
- Case-insensitive scan for `opencode`, `beppe2880`, `OpenCode Mobile`, `t3code`, `pingdotgg`: 0
  files, so nothing from the `opencode-mobile` zip or earlier projects is in the app.
- Third-party code: AndroidX, the Kotlin standard library, ZXing core and ZXing Android Embedded,
  all Apache-2.0, recorded in `assets/third-party-licenses.txt` inside the APK and in `NOTICE`.
- `usesCleartextTraffic` is off and the network security config trusts no certificate authority,
  so the only trust the app has is the runtime pin.

## Inferences and unknowns

Static inventory does not prove runtime behaviour; that is covered by `docs/QA-BETA4.md`. The APK
is rebuilt for release with the same key, so the published hash differs from this evidence by the
later source changes noted in the release commit.
