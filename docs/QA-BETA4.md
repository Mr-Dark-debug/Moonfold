# QA: beta 4 and Moonfold for Android beta 1 (2026-11-02)

Live checks on Windows 11 with a production build of the server in a scratch home, driven by the
Android 16 emulator (`sdk_gphone64_x86_64`, WebView 133) over the machine's LAN address. Pairing
payloads came from the real `/api/auth/pairing-token` and `/api/auth/mobile-access` endpoints. The
scratch home, the app on the emulator and the emulator's settings were cleaned up afterwards.

## Pairing and reconnecting

| Check                                                                    | Result                              |
| ------------------------------------------------------------------------ | ----------------------------------- |
| First launch shows the splash, then the scan screen                      | Pass                                |
| A pairing link asks first, naming the computer and address               | Pass                                |
| Pairing with no login; the host lists `mobile-app`, `mobile`, Android    | Pass                                |
| WebSocket over pinned TLS (`connected: true` on the host)                | Pass                                |
| Session lasts 365 days                                                   | Pass (`expiresAt` 2027-11-02)       |
| Force-stop and reopen the app: no scan needed                            | Pass, debug and signed release      |
| Host stopped: "Waiting for" screen; host restarted: reconnects untouched | Pass                                |
| Phone reboot: still paired                                               | Pass                                |
| Same session works on a second address with no new scan                  | Pass (10.0.2.2 and the LAN address) |
| Pairing again replaces the session instead of adding one                 | Pass                                |
| A paired phone skips the first-run wizard                                | Pass                                |

## Security

| Check                                                         | Result                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Wrong certificate in the code: refused                        | Pass. The token was never sent: the same token paired afterwards         |
| Same address with a different certificate: refused            | Pass. App stays on "Waiting for"; `connected: false` on the host         |
| Revoke in Connections: phone disconnected and pairing cleared | Pass, about 10 seconds                                                   |
| Phone session scopes                                          | Pass. No `access:write`, so a phone cannot pair others or revoke clients |
| Settings → Mobile App off by default                          | Pass                                                                     |

## The UI on a phone

| Check                                                                                | Result                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Start a thread, pick a model, type, send                                             | Pass                                                                            |
| The provider's real response reaches the phone                                       | Pass, a Codex usage limit with the handoff and reset actions                    |
| Settings pages at 412px: General, Mobile App, Connections, Providers, Source Control | Pass, no horizontal overflow                                                    |
| Keyboard open: composer stays above it                                               | Pass                                                                            |
| Landscape                                                                            | Pass                                                                            |
| Dark mode                                                                            | Pass after two fixes: system bars now follow the page, and the blue theme below |
| Attach files opens the phone's picker and returns                                    | Pass                                                                            |

Found and fixed: on Chromium up to 133 the whole dark theme rendered saturated blue, because the
build minifies achromatic `oklch()` to a `none` hue and `color-mix()` mishandles it. It would also
have hit older browsers on the web client. The neutrals are hex now.

## Desktop

| Check                                                       | Result                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Settings → Mobile App shows a QR code                       | Pass                                                                                 |
| That QR format decodes exactly in an independent reader     | Pass (jsQR, and ZXing in the app's unit tests)                                       |
| Settings → Prompt Profiles → Agent limits shows both rows   | Pass                                                                                 |
| Content exclusions reach the prompt and Claude's deny rules | Unit tests pass. Not run against a live agent, see below                             |
| Token limit stops a run                                     | Unit tests pass: fires once, ignores subagents, no limit means no stop. Not run live |

## Not verified on this machine

- **The camera scanning a real code.** The scanner opens and frames correctly on the emulator, and
  its virtual camera cannot be aimed at a poster, so the decode was tested separately as above. Try
  it once on a real phone.
- **A real phone on real Wi-Fi.** The emulator reaches the host through its own network stack, so
  Windows Firewall never asked. A real phone may need the prompt allowed for private networks; the
  guide says so.
- **Tailscale.** The second-address case was tested with two local addresses.
- **A full agent turn on the phone.** Codex is at its usage limit until 19 November and Claude Code
  is not signed in on this machine, so no agent could complete a turn. The same gap covers live
  runs of content exclusions and the token limit.
- **The packaged desktop app.** The listener was tested in the production server build, which the
  desktop app bundles, not in an installed desktop app.

Emulator note: the emulator's software renderer crashed twice while drawing heavy pages, in the
emulator itself. Everything above ran on its hardware renderer.
