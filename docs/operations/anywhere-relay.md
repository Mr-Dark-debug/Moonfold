# Running an Anywhere relay

Reach from anywhere (D-69) needs a relay both a phone and a computer can reach. It forwards encrypted
bytes and stores nothing. There are two ways to run one, with the same protocol
(`packages/shared/src/anywhereRelay.ts`).

## On Cloudflare Workers (free plan)

From `infra/anywhere-relay`, with a Cloudflare account signed in to Wrangler:

```bash
npx wrangler@4 deploy
```

The relay is then at `wss://moonfold-anywhere-relay.<account>.workers.dev`. A custom domain is
optional. One Durable Object holds each room, and its WebSockets hibernate, so a computer that is
only waiting costs nothing; pings are answered without waking it.

The free plan allows 100,000 requests and 13,000 GB-seconds of Durable Object time a day. An
active stream keeps its room's object awake, about 28 object-hours a day in total across every user
of the deployment. Past that, the Workers Paid plan applies.

To make it the default for a release, set `DEFAULT_ANYWHERE_RELAY_URL` in
`packages/contracts/src/settings.ts` to its address before building.

## On any machine with Node

```bash
moonfold relay --port 8787
```

Put it behind a TLS proxy (Caddy, nginx or similar) so clients reach it as `wss://`. Android release
builds connect only to `wss://` relays. `GET /health` answers `ok`.

## What it can see

Which room is active, when, and how many bytes flow, plus IP addresses. It cannot read the traffic,
which is the phone's TLS session with the computer, and it never holds a key, token or login. Logs
of any proxy in front of it should keep no more than that.
