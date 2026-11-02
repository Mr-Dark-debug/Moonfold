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

The phone needs a network it shares with your computer: the same Wi-Fi, or
[Tailscale](./remote-access.md) or a VPN to use it away from home. Moonfold runs no service in
between, so with neither of those the phone shows **Waiting for** your computer.

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
