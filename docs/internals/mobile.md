# Mobile access

The Android app (`apps/mobile`) is a thin client of the host's own web UI, so a feature that works
in the web client works on the phone. These are the decisions a change here could break.

## Why a second listener

The main server stays on loopback by default and serves plain HTTP. A phone needs a route that is
reachable and encrypted, without a domain or a certificate authority (CLAUDE.md rules 6 and 7). So `MobileAccess.ts` runs an HTTPS listener with a self-signed certificate on every
interface, only while `mobileAccessEnabled` is on. It re-emits requests and upgrades into the main
server, so auth, scopes and routes have one implementation. It overwrites `x-forwarded-proto`
because this listener is the one that knows the transport; that is what marks cookies `Secure`.

## Trust comes from the QR code

The code carries the certificate's SHA-256, and the app trusts that certificate and nothing else.
Hostnames are not checked: the pin identifies the host, and a machine's address changes between
networks. Two code paths enforce it and must stay in step: `PinnedTrustManager` for the app's own
requests, and `onReceivedSslError` for everything the web view loads, including the WebSocket. A
self-signed certificate always reaches `onReceivedSslError`, so that handler is the pin.

The one-time token is sent only after the pinned TLS handshake, so a wrong certificate learns
nothing. A `moonfold://mobile-pair` link can come from any page, so it asks before pairing; a scan
does not.

## The session is a cookie on every address

Cookies belong to one host, and a phone reaches a computer by whichever address its network offers.
The app exchanges the token itself, then writes the session cookie for every address in the code,
which is why moving from Wi-Fi to Tailscale needs no new scan. Sessions from a `mobile` pairing last
365 days instead of 30, so an idle phone is not logged out. Revoking one in Settings → Connections
ends it, and the app's next check returns it to the scan screen.

## Reach from anywhere is a byte pipe under the same TLS

With `anywhereEnabled`, the server keeps one outbound WebSocket to a relay (`anywhereHost.ts`)
and the app listens on `127.0.0.1` at the computer's own mobile port (`RelayProxy.kt`). Each
connection the web view makes there becomes one relay stream, which the computer pipes into
its own HTTPS listener. So `127.0.0.1` is just one more address of the host: the pin, the
cookie on every address and `isHostUrl` all work unchanged, and the relay only ever sees the
TLS bytes. Using the same port number is what keeps the origin stable; a phone where that port
is taken cannot use the relay.

The protocol is `packages/shared/src/anywhereRelay.ts`. A room is the SHA-256 of the computer's
Ed25519 key, which never leaves `userdata/mobile-access`; the computer proves ownership by
signing a challenge, and signs each stream it accepts. A phone needs nothing but the room id
from the code, because opening a stream only reaches the same TLS listener and session check
as being on the network. A hostile relay can drop or delay streams and see timing and volume;
it cannot read, change or start a session. The Node relay (`moonfold relay`) and the Workers
relay (`infra/anywhere-relay`) implement the same rules; the Workers one keeps its state in
socket tags and attachments because hibernation drops memory.

## What the app does not do

It keeps no agent data and runs nothing in the background, so it has no notifications. A new
address on the host (a new network, or a certificate replaced by deleting
`userdata/mobile-access`) needs a new scan. Turning on Reach from anywhere also needs a new scan,
since the code carries the relay.
