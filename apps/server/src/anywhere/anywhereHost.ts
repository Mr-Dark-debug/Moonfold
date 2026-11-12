// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off globalRandom:off - Raw sockets beside the Node HTTP server, like the mobile listener.
/**
 * The computer's side of Anywhere (D-69): one control socket to the relay, and for each phone
 * stream a second socket piped to the local mobile HTTPS port. The bytes are the phone's TLS
 * session with that port, so this file never sees what they carry.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodePath from "node:path";

import {
  acceptProofMessage,
  HOST_PING_MS,
  hostProofMessage,
  MAX_STREAMS_PER_ROOM,
  parseControl,
  type RelayToHost,
  roomIdForKey,
  toBase64Url,
} from "@moonfold/shared/anywhereRelay";

export interface AnywhereKey {
  readonly room: string;
  /** Base64url SPKI DER of the public key, as the relay expects it. */
  readonly publicKey: string;
  readonly sign: (message: string) => string;
}

/** The computer's room key: made once, kept in the mobile-access folder next to its certificate. */
export async function loadOrCreateAnywhereKey(directory: string): Promise<AnywhereKey> {
  const file = NodePath.join(directory, "anywhere-key.pem");
  const pem = await NodeFSP.readFile(file, "utf8").catch(() => null);
  const privateKey =
    pem === null
      ? NodeCrypto.generateKeyPairSync("ed25519").privateKey
      : NodeCrypto.createPrivateKey(pem);
  if (pem === null) {
    await NodeFSP.mkdir(directory, { recursive: true });
    await NodeFSP.writeFile(file, privateKey.export({ type: "pkcs8", format: "pem" }), {
      mode: 0o600,
    });
  }
  const spki = new Uint8Array(
    NodeCrypto.createPublicKey(privateKey).export({ type: "spki", format: "der" }),
  );
  return {
    room: await roomIdForKey(spki),
    publicKey: toBase64Url(spki),
    sign: (message) =>
      toBase64Url(new Uint8Array(NodeCrypto.sign(null, Buffer.from(message), privateKey))),
  };
}

/** `wss://relay.example/base` with no trailing slash; anything else is not a relay address. */
export function normalizeRelayUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    if (url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export interface AnywhereHostStatus {
  readonly connected: boolean;
  readonly streams: number;
}

export interface AnywhereHost {
  readonly stop: () => void;
}

/** Bytes queued on one stream's socket before the local side is paused. */
const HIGH_WATER_BYTES = 4 * 1024 * 1024;
const MAX_BACKOFF_MS = 30_000;

export function startAnywhereHost(input: {
  readonly relayUrl: string;
  readonly key: AnywhereKey;
  /** The mobile HTTPS port on this machine. */
  readonly targetPort: number;
  readonly onStatus: (status: AnywhereHostStatus) => void;
  readonly onError?: (message: string) => void;
}): AnywhereHost {
  const { key } = input;
  let stopped = false;
  let control: WebSocket | null = null;
  let connected = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  let lastPong = 0;
  const streams = new Set<{ readonly close: () => void }>();

  const report = () => input.onStatus({ connected, streams: streams.size });

  const accept = (id: string) => {
    if (streams.size >= MAX_STREAMS_PER_ROOM) return;
    const params = new URLSearchParams({
      key: key.publicKey,
      sig: key.sign(acceptProofMessage(key.room, id)),
    });
    const socket = new WebSocket(`${input.relayUrl}/v1/accept/${key.room}/${id}?${params}`);
    socket.binaryType = "arraybuffer";
    const local = NodeNet.connect({ host: "127.0.0.1", port: input.targetPort });
    const toLocal: Array<Buffer> = [];
    let localReady = false;
    let paused: ReturnType<typeof setInterval> | null = null;
    const stream = {
      close: () => {
        if (paused !== null) clearInterval(paused);
        local.destroy();
        if (socket.readyState <= WebSocket.OPEN) socket.close(1000, "closed");
        if (streams.delete(stream)) report();
      },
    };
    streams.add(stream);
    report();
    local.on("connect", () => {
      localReady = true;
      for (const chunk of toLocal.splice(0)) local.write(chunk);
    });
    local.on("data", (chunk) => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(chunk);
      // The relay drains slower than localhost fills; wait for the socket rather than buffer it all.
      if (socket.bufferedAmount > HIGH_WATER_BYTES && paused === null) {
        local.pause();
        paused = setInterval(() => {
          if (socket.bufferedAmount > HIGH_WATER_BYTES / 2) return;
          if (paused !== null) clearInterval(paused);
          paused = null;
          local.resume();
        }, 25);
      }
    });
    socket.addEventListener("message", (event) => {
      if (!(event.data instanceof ArrayBuffer)) return;
      const chunk = Buffer.from(event.data);
      if (localReady) local.write(chunk);
      else toLocal.push(chunk);
    });
    socket.addEventListener("close", stream.close);
    socket.addEventListener("error", stream.close);
    local.on("close", stream.close);
    local.on("error", stream.close);
  };

  const scheduleReconnect = () => {
    if (stopped || retry !== null) return;
    // Doubling with jitter, so many computers that lost the relay together do not return together.
    const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts) * (0.75 + Math.random() / 2);
    attempts += 1;
    retry = setTimeout(() => {
      retry = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    const socket = new WebSocket(`${input.relayUrl}/v1/host/${key.room}`);
    control = socket;
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const message = parseControl<RelayToHost>(event.data, ["challenge", "ready", "open", "pong"]);
      if (message === null) return;
      switch (message.t) {
        case "challenge":
          socket.send(
            JSON.stringify({
              t: "hello",
              key: key.publicKey,
              sig: key.sign(hostProofMessage(key.room, message.nonce)),
            }),
          );
          return;
        case "ready":
          connected = true;
          attempts = 0;
          lastPong = Date.now();
          report();
          return;
        case "open":
          accept(message.id);
          return;
        case "pong":
          lastPong = Date.now();
          return;
      }
    });
    socket.addEventListener("close", (event) => {
      if (control === socket) control = null;
      if (connected) {
        connected = false;
        report();
      }
      if (event.code === 4003) input.onError?.("The relay refused this computer's key.");
      scheduleReconnect();
    });
    socket.addEventListener("error", () => input.onError?.("Could not reach the relay."));
  };

  ping = setInterval(() => {
    if (control === null || !connected) return;
    // A connection that stopped answering is replaced instead of waiting for TCP to notice.
    if (Date.now() - lastPong > HOST_PING_MS * 2.5) {
      control.close(4000, "silent");
      return;
    }
    control.send(JSON.stringify({ t: "ping" }));
  }, HOST_PING_MS);

  connect();
  return {
    stop: () => {
      stopped = true;
      if (retry !== null) clearTimeout(retry);
      if (ping !== null) clearInterval(ping);
      control?.close(1000, "stopped");
      for (const stream of streams) stream.close();
      connected = false;
    },
  };
}
