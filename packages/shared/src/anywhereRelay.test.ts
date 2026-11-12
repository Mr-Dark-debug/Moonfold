import { describe, expect, it } from "vite-plus/test";

import {
  acceptProofMessage,
  CLOSE_CODES,
  hostProofMessage,
  MAX_EARLY_BYTES,
  parseRelayPath,
  RelayCore,
  type RelaySocket,
  roomIdForKey,
  toBase64Url,
} from "./anywhereRelay.ts";

class FakeSocket implements RelaySocket {
  readonly sent: Array<string | Uint8Array> = [];
  closedWith: number | null = null;
  send(data: string | Uint8Array) {
    this.sent.push(data);
  }
  close(code: number) {
    this.closedWith ??= code;
  }
  get json() {
    return this.sent.filter((item) => typeof item === "string").map((item) => JSON.parse(item));
  }
}

async function makeKey() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  const room = await roomIdForKey(spki);
  const sign = async (message: string) =>
    toBase64Url(
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "Ed25519" },
          pair.privateKey,
          new TextEncoder().encode(message),
        ),
      ),
    );
  return { room, key: toBase64Url(spki), sign };
}

function harness() {
  const timers: Array<{ run: () => void; cleared: boolean }> = [];
  let next = 0;
  const core = new RelayCore({
    // 22 characters, the stream id length.
    randomId: () => `id${String(next++).padStart(20, "0")}`,
    setTimer: (run) => {
      const timer = { run, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  });
  const fire = () => timers.filter((timer) => !timer.cleared).forEach((timer) => timer.run());
  return { core, fire };
}

async function onlineHost(core: RelayCore) {
  const key = await makeKey();
  const host = new FakeSocket();
  core.hostConnected(key.room, host);
  const { nonce } = host.json[0];
  await core.hostMessage(
    host,
    JSON.stringify({
      t: "hello",
      key: key.key,
      sig: await key.sign(hostProofMessage(key.room, nonce)),
    }),
  );
  return { key, host };
}

describe("RelayCore", () => {
  it("joins a phone stream to the host's accepted socket and copies bytes both ways", async () => {
    const { core } = harness();
    const { key, host } = await onlineHost(core);
    expect(host.json.map((message) => message.t)).toEqual(["challenge", "ready"]);

    const phone = new FakeSocket();
    core.phoneConnected(key.room, phone);
    const { id } = host.json.at(-1);
    // Bytes the phone sends before the host accepts are held, then delivered in order.
    core.data(phone, new Uint8Array([1, 2]));
    const accept = new FakeSocket();
    await core.hostAccepted(
      key.room,
      id,
      { key: key.key, sig: await key.sign(acceptProofMessage(key.room, id)) },
      accept,
    );
    expect(accept.sent).toEqual([new Uint8Array([1, 2])]);
    core.data(accept, new Uint8Array([3]));
    core.data(phone, new Uint8Array([4]));
    expect(phone.sent).toEqual([new Uint8Array([3])]);
    expect(accept.sent.at(-1)).toEqual(new Uint8Array([4]));

    core.closed(phone);
    expect(accept.closedWith).toBe(1000);
  });

  it("refuses a host or an accept signed by any other key", async () => {
    const { core } = harness();
    const owner = await makeKey();
    const stranger = await makeKey();
    const impostor = new FakeSocket();
    core.hostConnected(owner.room, impostor);
    const { nonce } = impostor.json[0];
    await core.hostMessage(
      impostor,
      JSON.stringify({
        t: "hello",
        key: stranger.key,
        sig: await stranger.sign(hostProofMessage(owner.room, nonce)),
      }),
    );
    expect(impostor.closedWith).toBe(CLOSE_CODES.badProof);

    const { key, host } = await onlineHost(core);
    const phone = new FakeSocket();
    core.phoneConnected(key.room, phone);
    const { id } = host.json.at(-1);
    const forged = new FakeSocket();
    await core.hostAccepted(
      key.room,
      id,
      { key: stranger.key, sig: await stranger.sign(acceptProofMessage(key.room, id)) },
      forged,
    );
    expect(forged.closedWith).toBe(CLOSE_CODES.badProof);
    // A replayed host signature does not open a stream.
    const replayed = new FakeSocket();
    await core.hostAccepted(
      key.room,
      id,
      { key: key.key, sig: await key.sign(hostProofMessage(key.room, id)) },
      replayed,
    );
    expect(replayed.closedWith).toBe(CLOSE_CODES.badProof);
  });

  it("turns phones away with no host, and closes waiting phones when the host goes", async () => {
    const { core, fire } = harness();
    const { room } = await makeKey();
    const early = new FakeSocket();
    core.phoneConnected(room, early);
    expect(early.closedWith).toBe(CLOSE_CODES.hostOffline);

    const { key, host } = await onlineHost(core);
    const waiting = new FakeSocket();
    core.phoneConnected(key.room, waiting);
    core.closed(host);
    expect(waiting.closedWith).toBe(CLOSE_CODES.hostOffline);

    const again = await onlineHost(core);
    const slow = new FakeSocket();
    core.phoneConnected(again.key.room, slow);
    fire();
    expect(slow.closedWith).toBe(CLOSE_CODES.timeout);
  });

  it("limits what a phone may send before the host accepts", async () => {
    const { core } = harness();
    const { key } = await onlineHost(core);
    const phone = new FakeSocket();
    core.phoneConnected(key.room, phone);
    core.data(phone, new Uint8Array(MAX_EARLY_BYTES));
    expect(phone.closedWith).toBeNull();
    core.data(phone, new Uint8Array(1));
    expect(phone.closedWith).toBe(CLOSE_CODES.limit);
  });

  it("replaces a host that reconnects", async () => {
    const { core } = harness();
    const key = await makeKey();
    const connect = async () => {
      const socket = new FakeSocket();
      core.hostConnected(key.room, socket);
      const { nonce } = socket.json[0];
      await core.hostMessage(
        socket,
        JSON.stringify({
          t: "hello",
          key: key.key,
          sig: await key.sign(hostProofMessage(key.room, nonce)),
        }),
      );
      return socket;
    };
    const first = await connect();
    const second = await connect();
    expect(first.closedWith).toBe(CLOSE_CODES.replaced);
    expect(second.closedWith).toBeNull();
  });
});

describe("parseRelayPath", () => {
  const room = "A".repeat(43);
  it("reads the three kinds of path, behind any prefix, and nothing else", () => {
    expect(parseRelayPath(`/v1/host/${room}`)).toEqual({ kind: "host", room });
    expect(parseRelayPath(`/relay/v1/connect/${room}`)).toEqual({ kind: "connect", room });
    expect(parseRelayPath(`/v1/accept/${room}/${"b".repeat(22)}`)).toEqual({
      kind: "accept",
      room,
      id: "b".repeat(22),
    });
    expect(parseRelayPath(`/v1/host/short`)).toBeNull();
    expect(parseRelayPath(`/v1/host/${room}/extra`)).toBeNull();
    expect(parseRelayPath(`/v1/accept/${room}`)).toBeNull();
    expect(parseRelayPath(`/v2/host/${room}`)).toBeNull();
  });
});
