# Anywhere: reach your computer from the phone on any network

Status: plan. Decision: D-69, which replaces the last sentence of D-58 ("Moonfold runs no relay").

## The problem

The Android app reaches the computer only on a network they share. On mobile data, or behind a
home router or a carrier's shared address (common in India), it shows "Waiting for your computer".
The owner wants it to work anywhere, with no account and no sign-up for the user.

## What is and is not possible

Two devices that both sit behind address translation cannot always connect directly. Something
reachable by both has to carry the traffic in those cases. So "works anywhere" needs a relay
somewhere; the real choice is whose, and whether it can read anything.

| Option                                                  | No sign-up for users | Works behind shared addresses | Relay can read traffic | Verdict                                                                                                                             |
| ------------------------------------------------------- | -------------------- | ----------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Tailscale, vendor remote services                       | No                   | Yes                           | Varies                 | Stays as an option, not the answer                                                                                                  |
| Account-less public tunnels (quick tunnels and similar) | Yes                  | Yes                           | Yes, unless we wrap it | Positioned by their owners for testing; address changes on every start; a 40 to 55 MB helper binary                                 |
| Peer-to-peer by key (iroh)                              | Yes                  | Yes, through its relays       | No                     | Promising; public relays are described as for development and testing, and we found no published Android package. A later transport |
| Peer-to-peer over WebRTC                                | Yes                  | Not when both ends are strict | No                     | No free relay fallback; a custom transport for the web client                                                                       |
| Tor onion service                                       | Yes                  | Yes                           | No                     | Slow to connect, blocked on some networks                                                                                           |
| Port forwarding, IPv6                                   | Yes                  | No                            | No                     | A bonus when it happens to work                                                                                                     |
| **A small blind relay of our own**                      | Yes                  | Yes                           | **No**                 | **Chosen**                                                                                                                          |

How similar tools solved it: the two closest open-source apps for driving coding agents from a
phone both use a relay that only sees encrypted bytes, paired by QR code.

## Design: a byte pipe under the TLS we already have

The phone already trusts exactly one certificate, the one whose fingerprint was in the QR code
(D-58). Anywhere keeps that and changes only how bytes travel:

```
web client in the app  →  local port on the phone  →  relay  →  computer's HTTPS port
        └──────────── the same pinned TLS session, end to end ────────────┘
```

- The relay joins two WebSocket connections and copies bytes. It never holds a key, a token, a
  login or a provider credential, and it cannot read or change what it carries. Rule 7 of
  CLAUDE.md holds: Moonfold does not become a token service.
- HTTP, WebSockets, pairing, sessions and revoking a phone work unchanged, because they all run
  inside the same TLS session as today.
- The phone tries the local network first, then the relay. The app shows which path is in use.

### Pieces

1. **Relay protocol** (`packages/shared`): a room per computer. The room id is a hash of a key the
   computer generates once; the computer proves it owns the room by signing the relay's challenge.
   A phone joins with the room id from its pairing. Streams are multiplexed over the computer's
   one outbound connection. Version field, size limits, idle timeouts, per-room rate limits.
2. **Relay server**, two forms from one core:
   - `moonfold relay`: a plain Node server anyone can run on any machine with a public address.
   - `infra/anywhere-relay`: the same logic for Cloudflare Workers with Durable Objects, which
     runs on the free plan (roughly 28 hours of active relaying a day across all users, by the
     published limits; idle connections cost nothing).
3. **Computer side** (`apps/server`, next to `mobileAccess/`): keeps one outbound connection to
   the relay while "Allow the mobile app to connect" and "Reach from anywhere" are on, and pipes
   each stream to its own HTTPS port. Reconnects with backoff. Only paired phones get past TLS and
   the session check, exactly as on the local network.
4. **Phone side** (`apps/mobile`): a listener on `127.0.0.1` that maps each connection to a relay
   stream, with the web client pointed at it and the same certificate check. Pairing code version
   2 adds the relay address and room id; version 1 codes keep working. Reconnect on network
   change.
5. **Settings**: Settings → Mobile App gets **Reach from anywhere** (on or off), the relay in use
   (default or your own address), the current path, and a note in plain words about what the relay
   can see: that the two devices are talking, when, and how much. Never what.

### The default relay

A release needs one relay address built in, or the feature does nothing out of the box. Running it
is the project's job, not the user's, and it is the one part of this plan that needs the owner:

- a free Cloudflare account for the project, and one deploy command (documented in
  `docs/operations/`);
- no domain is required; a custom one can be added later;
- cost is zero on the free plan up to its daily limits, then about five dollars a month.

Until the owner deploys it, builds ship with no default and the setting asks for a relay address.
Anyone can point their install at their own relay, so the project's relay is never a lock-in.

## Security

- Authentication and encryption are unchanged: pinned TLS plus the paired session.
- The room key lives in the server's secret store and never leaves the computer.
- The relay enforces sizes, rates and idle limits, keeps no logs of content (it has none) and no
  history. Its code is in this repository under MIT.
- The phone's local port accepts connections only while the app is in front and still requires
  the session, since other apps on the phone can reach `127.0.0.1`.
- Threat notes to write up in `docs/internals/`: a hostile relay can drop or delay traffic and see
  timing, nothing else; a stolen pairing is handled by revoking the phone, as today.

## Hit every surface

- **Clients:** Android only. A browser cannot pin a certificate or open a local port, so a browser
  on another network stays on Tailscale or an SSH tunnel. The user guide says so.
- **Connection modes:** local, relay, and the existing Tailscale and SSH paths keep working.
- **Reverse states:** turning the setting off closes the relay connection at once; revoking a
  phone works on either path.
- **Docs:** `docs/user/mobile-app.md`, `docs/user/remote-access.md`, `docs/internals/mobile.md`,
  a relay operations page.
- **REA gate:** on the relay bundle and the new APK. New dependency on Android: OkHttp
  (Apache-2.0) for WebSockets, to be licence-checked.

## Tests

Protocol tests with a local relay (join, proof of ownership, multiplexing, limits, reconnect); a
server integration test that drives a real HTTPS request through a local relay; Kotlin unit tests
for pairing code version 2 and the local listener; one end-to-end run on the Android emulator with
the computer's local address blocked, so only the relay path can work.

## Order of work

1. Protocol and the Node relay, with tests.
2. Computer-side client and settings.
3. Android listener, pairing version 2, path indicator.
4. Workers relay.
5. Emulator end-to-end run, docs, REA gate, new APK.
6. Later, behind the same transport seam: a direct peer-to-peer path when both ends allow it.

## What cannot be promised

- A relay with no cost at any scale: the free plan has daily limits.
- Reach while the computer sleeps or Moonfold is closed. A keep-awake option helps; it does not
  wake a sleeping laptop.
- Instant resume on Android: the system cuts idle connections, so expect a short reconnect when
  the app returns to the front.
- Hiding from the relay that two devices are talking.
