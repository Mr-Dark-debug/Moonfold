/**
 * Anywhere (D-69): the protocol of a blind relay that joins a phone to the computer's pinned
 * HTTPS port. It copies bytes and holds no key, token or login. Shared by the computer, the Node
 * relay and the Workers relay; docs/internals/mobile.md explains the design.
 */

const ANYWHERE_PROTOCOL = "moonfold-anywhere-v1";

/** Streams one room may hold at once: a web client uses a handful. */
export const MAX_STREAMS_PER_ROOM = 64;
/** Phone streams waiting for the host to accept. */
export const MAX_PENDING_PER_ROOM = 16;
/** How long a phone stream waits for the host to accept it. */
export const PENDING_TIMEOUT_MS = 15_000;
/** Bytes a phone may send before its stream is accepted (the start of a TLS handshake fits). */
export const MAX_EARLY_BYTES = 256 * 1024;
/** Largest single message either side may send. */
export const MAX_MESSAGE_BYTES = 1024 * 1024;
/** The host pings this often; a relay drops a host it has not heard from in three times this. */
export const HOST_PING_MS = 25_000;

export const CLOSE_CODES = {
  hostOffline: 4004,
  replaced: 4001,
  badProof: 4003,
  limit: 4029,
  timeout: 4008,
  protocol: 4002,
} as const;

const ROOM_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const STREAM_PATTERN = /^[A-Za-z0-9_-]{22}$/;

const isRoomId = (value: string) => ROOM_PATTERN.test(value);
const isStreamId = (value: string) => STREAM_PATTERN.test(value);

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  try {
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The room a key owns: the base64url SHA-256 of its SPKI DER encoding. */
export async function roomIdForKey(spki: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", spki as Uint8Array<ArrayBuffer>);
  return toBase64Url(new Uint8Array(digest));
}

export const hostProofMessage = (room: string, nonce: string) =>
  `${ANYWHERE_PROTOCOL}:host:${room}:${nonce}`;
export const acceptProofMessage = (room: string, stream: string) =>
  `${ANYWHERE_PROTOCOL}:accept:${room}:${stream}`;

/** Whether `sig` is the room key's Ed25519 signature of `message`, and the key owns `room`. */
export async function verifyRoomProof(input: {
  readonly room: string;
  readonly key: string;
  readonly sig: string;
  readonly message: string;
}): Promise<boolean> {
  const key = fromBase64Url(input.key);
  const sig = fromBase64Url(input.sig);
  if (key === null || sig === null || key.length > 128 || sig.length !== 64) return false;
  if ((await roomIdForKey(key)) !== input.room) return false;
  try {
    const imported = await crypto.subtle.importKey(
      "spki",
      key as Uint8Array<ArrayBuffer>,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    return await crypto.subtle.verify(
      { name: "Ed25519" },
      imported,
      sig as Uint8Array<ArrayBuffer>,
      new TextEncoder().encode(input.message),
    );
  } catch {
    return false;
  }
}

export type HostToRelay =
  | { readonly t: "hello"; readonly key: string; readonly sig: string }
  | { readonly t: "ping" };
export type RelayToHost =
  | { readonly t: "challenge"; readonly nonce: string }
  | { readonly t: "ready" }
  | { readonly t: "open"; readonly id: string }
  | { readonly t: "pong" };

export function parseControl<T extends { readonly t: string }>(
  text: string,
  kinds: ReadonlyArray<T["t"]>,
): T | null {
  if (text.length > 4096) return null;
  try {
    const value: unknown = JSON.parse(text);
    if (typeof value !== "object" || value === null) return null;
    const t = (value as { readonly t?: unknown }).t;
    if (typeof t !== "string" || !kinds.includes(t)) return null;
    for (const field of Object.values(value)) if (typeof field !== "string") return null;
    return value as T;
  } catch {
    return null;
  }
}

/** One end of a WebSocket as the relay core sees it. */
export interface RelaySocket {
  send(data: string | Uint8Array): void;
  close(code: number, reason: string): void;
}

/** What the core needs from its runtime: ids, and a timer it can cancel. */
export interface RelayRuntime {
  readonly randomId: () => string;
  readonly setTimer: (run: () => void, ms: number) => unknown;
  readonly clearTimer: (timer: unknown) => void;
}

interface PendingStream {
  readonly phone: RelaySocket;
  readonly early: Array<Uint8Array>;
  earlyBytes: number;
  readonly timer: unknown;
}

interface Room {
  host: RelaySocket | null;
  /** The challenge sent to a host that has not proved itself yet. */
  readonly challenges: Map<RelaySocket, string>;
  readonly pending: Map<string, PendingStream>;
  /** Paired streams: each side maps to the other. */
  readonly peers: Map<RelaySocket, RelaySocket>;
}

/**
 * The relay's state, independent of the transport: the Node relay feeds it from `ws`, the Workers
 * relay from a Durable Object.
 */
export class RelayCore {
  private readonly rooms = new Map<string, Room>();
  private readonly roomOf = new Map<RelaySocket, string>();
  private readonly runtime: RelayRuntime;

  constructor(runtime: RelayRuntime) {
    this.runtime = runtime;
  }

  private room(id: string): Room {
    let room = this.rooms.get(id);
    if (room === undefined) {
      room = { host: null, challenges: new Map(), pending: new Map(), peers: new Map() };
      this.rooms.set(id, room);
    }
    return room;
  }

  private forgetIfEmpty(id: string) {
    const room = this.rooms.get(id);
    if (
      room !== undefined &&
      room.host === null &&
      room.challenges.size === 0 &&
      room.pending.size === 0 &&
      room.peers.size === 0
    ) {
      this.rooms.delete(id);
    }
  }

  /** A computer opened its control socket; it gets a challenge to sign. */
  hostConnected(roomId: string, socket: RelaySocket) {
    if (!isRoomId(roomId)) return socket.close(CLOSE_CODES.protocol, "bad room");
    const nonce = this.runtime.randomId();
    this.room(roomId).challenges.set(socket, nonce);
    this.roomOf.set(socket, roomId);
    socket.send(JSON.stringify({ t: "challenge", nonce } satisfies RelayToHost));
  }

  /** A text message on a control socket. */
  async hostMessage(socket: RelaySocket, text: string): Promise<void> {
    const roomId = this.roomOf.get(socket);
    const room = roomId === undefined ? undefined : this.rooms.get(roomId);
    if (roomId === undefined || room === undefined) return;
    const message = parseControl<HostToRelay>(text, ["hello", "ping"]);
    if (message === null) return socket.close(CLOSE_CODES.protocol, "bad message");
    if (message.t === "ping") {
      if (room.host === socket) socket.send(JSON.stringify({ t: "pong" } satisfies RelayToHost));
      return;
    }
    const nonce = room.challenges.get(socket);
    if (nonce === undefined) return;
    room.challenges.delete(socket);
    const proven = await verifyRoomProof({
      room: roomId,
      key: message.key,
      sig: message.sig,
      message: hostProofMessage(roomId, nonce),
    });
    if (!proven) {
      this.roomOf.delete(socket);
      socket.close(CLOSE_CODES.badProof, "bad proof");
      return this.forgetIfEmpty(roomId);
    }
    // A computer that reconnects replaces its old socket, which may be half dead.
    if (room.host !== null && room.host !== socket) {
      this.roomOf.delete(room.host);
      room.host.close(CLOSE_CODES.replaced, "replaced");
    }
    room.host = socket;
    socket.send(JSON.stringify({ t: "ready" } satisfies RelayToHost));
  }

  /** A phone opened a stream. It waits for the host to accept, buffering what it sends. */
  phoneConnected(roomId: string, phone: RelaySocket) {
    const room = isRoomId(roomId) ? this.rooms.get(roomId) : undefined;
    if (room === undefined || room.host === null) {
      return phone.close(CLOSE_CODES.hostOffline, "computer offline");
    }
    if (room.pending.size >= MAX_PENDING_PER_ROOM || room.peers.size / 2 >= MAX_STREAMS_PER_ROOM) {
      return phone.close(CLOSE_CODES.limit, "too many streams");
    }
    const id = this.runtime.randomId();
    const timer = this.runtime.setTimer(() => {
      if (room.pending.get(id)?.phone !== phone) return;
      room.pending.delete(id);
      this.roomOf.delete(phone);
      phone.close(CLOSE_CODES.timeout, "not accepted");
      this.forgetIfEmpty(roomId);
    }, PENDING_TIMEOUT_MS);
    room.pending.set(id, { phone, early: [], earlyBytes: 0, timer });
    this.roomOf.set(phone, roomId);
    room.host.send(JSON.stringify({ t: "open", id } satisfies RelayToHost));
  }

  /** The host's side of stream `id`, carrying its own proof. */
  async hostAccepted(
    roomId: string,
    id: string,
    proof: { readonly key: string; readonly sig: string },
    socket: RelaySocket,
  ): Promise<void> {
    const room = this.rooms.get(roomId);
    const waiting = room?.pending.get(id);
    if (room === undefined || waiting === undefined || !isStreamId(id)) {
      return socket.close(CLOSE_CODES.protocol, "no such stream");
    }
    const proven = await verifyRoomProof({
      room: roomId,
      ...proof,
      message: acceptProofMessage(roomId, id),
    });
    // The phone may have given up while the proof was checked.
    if (room.pending.get(id) !== waiting) return socket.close(CLOSE_CODES.timeout, "gone");
    if (!proven) return socket.close(CLOSE_CODES.badProof, "bad proof");
    room.pending.delete(id);
    this.runtime.clearTimer(waiting.timer);
    room.peers.set(waiting.phone, socket);
    room.peers.set(socket, waiting.phone);
    this.roomOf.set(socket, roomId);
    for (const chunk of waiting.early) socket.send(chunk);
  }

  /** A binary message from either side of a stream. */
  data(socket: RelaySocket, chunk: Uint8Array) {
    const roomId = this.roomOf.get(socket);
    const room = roomId === undefined ? undefined : this.rooms.get(roomId);
    if (room === undefined) return;
    if (chunk.byteLength > MAX_MESSAGE_BYTES) return this.closed(socket, CLOSE_CODES.limit);
    const peer = room.peers.get(socket);
    if (peer !== undefined) return peer.send(chunk);
    for (const waiting of room.pending.values()) {
      if (waiting.phone !== socket) continue;
      waiting.earlyBytes += chunk.byteLength;
      if (waiting.earlyBytes > MAX_EARLY_BYTES) return this.closed(socket, CLOSE_CODES.limit);
      waiting.early.push(chunk);
      return;
    }
  }

  /** A socket closed or failed. Its peer, or every stream when it was the host, closes too. */
  closed(socket: RelaySocket, code: number = 1000) {
    const roomId = this.roomOf.get(socket);
    this.roomOf.delete(socket);
    const room = roomId === undefined ? undefined : this.rooms.get(roomId);
    if (roomId === undefined || room === undefined) return;
    room.challenges.delete(socket);
    if (code !== 1000) socket.close(code, "closed");
    const peer = room.peers.get(socket);
    if (peer !== undefined) {
      room.peers.delete(socket);
      room.peers.delete(peer);
      this.roomOf.delete(peer);
      peer.close(1000, "peer closed");
    }
    for (const [id, waiting] of room.pending) {
      if (waiting.phone !== socket) continue;
      this.runtime.clearTimer(waiting.timer);
      room.pending.delete(id);
    }
    if (room.host === socket) {
      room.host = null;
      for (const [id, waiting] of room.pending) {
        this.runtime.clearTimer(waiting.timer);
        this.roomOf.delete(waiting.phone);
        waiting.phone.close(CLOSE_CODES.hostOffline, "computer offline");
        room.pending.delete(id);
      }
    }
    this.forgetIfEmpty(roomId);
  }

  /** Rooms held, for a health endpoint. Never says which. */
  get roomCount() {
    return this.rooms.size;
  }
}

/** Splits a relay request path into what it asks for, or null. */
export function parseRelayPath(
  pathname: string,
):
  | { readonly kind: "host"; readonly room: string }
  | { readonly kind: "connect"; readonly room: string }
  | { readonly kind: "accept"; readonly room: string; readonly id: string }
  | null {
  const parts = pathname.split("/").filter((part) => part !== "");
  const v1 = parts.indexOf("v1");
  if (v1 < 0) return null;
  const [kind, room, id, extra] = parts.slice(v1 + 1);
  if (room === undefined || !isRoomId(room) || extra !== undefined) return null;
  if (kind === "host" && id === undefined) return { kind, room };
  if (kind === "connect" && id === undefined) return { kind, room };
  if (kind === "accept" && id !== undefined && isStreamId(id)) return { kind, room, id };
  return null;
}
