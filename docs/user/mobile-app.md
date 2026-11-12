# Mobile app

Moonfold for Android shows the Moonfold running on your computer: the same threads, agents,
approvals and settings, live. There is no account. You scan a code once, and the phone stays paired.

The app is in beta and comes as an APK from the
[releases page](https://github.com/Mr-Dark-debug/Moonfold/releases). Android asks you to allow
installs from your browser or file manager the first time. There is no iPhone app yet.

## Connect your phone

1. On your computer, open **Settings → Mobile App** and turn on **Allow the mobile app to connect**.
2. Open Moonfold on your phone and tap **Scan code**.
3. Point the camera at the code. The phone connects and shows Moonfold.

If your computer asks whether Moonfold may accept connections on the network, allow it for private
networks. Without that, the phone cannot reach it.

A code works once and for a few minutes, and Settings shows a new one by itself.

## Reaching your computer

On the same Wi-Fi, or over [Tailscale](./remote-access.md) or a VPN, the phone connects to your
computer directly.

To use it anywhere else, on mobile data or another Wi-Fi, turn on **Reach from anywhere** in
**Settings → Mobile App**, then scan a new code. There is still no account. A relay passes the
phone's connection along; the connection stays encrypted end to end, so the relay can see that
your phone and computer are talking, when and how much, but never what. The phone tries your
network first and the relay only when that fails.

The relay is a small service someone has to run. If Moonfold's own relay is not set up in your
build, the setting asks for an address: run `moonfold relay` on any machine both devices can
reach, behind TLS, or deploy the free Cloudflare version (see
[the relay guide](../operations/anywhere-relay.md)), and enter its `wss://` address.

Without either of these the phone shows **Waiting for** your computer.

Close and reopen the app as often as you like. While Moonfold runs on your computer the phone
connects by itself; if your computer sleeps or Moonfold closes, it waits and reconnects when it
returns.

If your computer joins a network it had no address on when you scanned, scan a new code.

## Security

The connection is encrypted, and the code tells the phone exactly which computer to trust, so
nobody on the network can read it or pose as your computer. Everything stays on your computer; the
app keeps only the pairing.

Paired phones are listed in **Settings → Connections**. Revoke one there and it is disconnected
within seconds. Turning off **Allow the mobile app to connect** stops the connection entirely.

A paired phone can do what you can in Moonfold, including approving agent actions, so revoke it if
you lose the phone.
