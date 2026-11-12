// @effect-diagnostics globalDate:off - A plain Workers module; the runtime gives no Effect clock.
/**
 * The Anywhere relay on Cloudflare Workers (D-69): one Durable Object per room, with hibernating
 * WebSockets so a computer that is only waiting costs nothing. The rules match `RelayCore` in
 * `@moonfold/shared/anywhereRelay`; state lives in socket tags and attachments instead of memory,
 * because a hibernating object loses its memory. The relay only copies bytes.
 */
import {
  CLOSE_CODES,
  HOST_PING_MS,
  hostProofMessage,
  MAX_EARLY_BYTES,
  MAX_MESSAGE_BYTES,
  MAX_PENDING_PER_ROOM,
  MAX_STREAMS_PER_ROOM,
  PENDING_TIMEOUT_MS,
  acceptProofMessage,
  parseControl,
  parseRelayPath,
  toBase64Url,
  verifyRoomProof,
  type HostToRelay,
  type RelayToHost,
} from "@moonfold/shared/anywhereRelay";

interface Env {
  readonly ROOMS: DurableObjectNamespace;
}

interface HostAttachment {
  readonly role: "host";
  readonly nonce: string;
  readonly proven: boolean;
}
interface PhoneAttachment {
  readonly role: "phone";
  readonly id: string;
  readonly openedAt: number;
}
type Attachment =
  | HostAttachment
  | PhoneAttachment
  | { readonly role: "accept"; readonly id: string };

const randomId = () => toBase64Url(crypto.getRandomValues(new Uint8Array(16)));
const send = (socket: WebSocket, message: RelayToHost) => socket.send(JSON.stringify(message));

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok\n");
    const route = parseRelayPath(url.pathname);
    if (route === null || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Moonfold Anywhere relay\n", { status: 404 });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(route.room)).fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class AnywhereRoom implements DurableObject {
  /** Phone bytes that arrived before the host accepted; lost only if the object hibernates. */
  private readonly early = new Map<string, Array<ArrayBuffer>>();
  private readonly state: DurableObjectState;

  constructor(state: DurableObjectState) {
    this.state = state;
    // Pings are answered without waking the object.
    state.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(
        JSON.stringify({ t: "ping" } satisfies HostToRelay),
        JSON.stringify({ t: "pong" } satisfies RelayToHost),
      ),
    );
  }

  private attachment(socket: WebSocket): Attachment | null {
    return (socket.deserializeAttachment() as Attachment | null) ?? null;
  }

  private provenHost(): WebSocket | null {
    for (const socket of this.state.getWebSockets("host")) {
      const attachment = this.attachment(socket);
      if (attachment?.role === "host" && attachment.proven) return socket;
    }
    return null;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = parseRelayPath(url.pathname);
    if (route === null) return new Response(null, { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (route.kind === "host") {
      const nonce = randomId();
      this.state.acceptWebSocket(server, ["host"]);
      server.serializeAttachment({ role: "host", nonce, proven: false } satisfies HostAttachment);
      send(server, { t: "challenge", nonce });
    } else if (route.kind === "connect") {
      const host = this.provenHost();
      this.state.acceptWebSocket(server, ["phone"]);
      const pending = this.state
        .getWebSockets("phone")
        .filter((socket) => this.state.getWebSockets(`a:${this.phoneId(socket)}`).length === 0);
      if (host === null) {
        server.close(CLOSE_CODES.hostOffline, "computer offline");
      } else if (
        pending.length > MAX_PENDING_PER_ROOM ||
        this.state.getWebSockets("accept").length >= MAX_STREAMS_PER_ROOM
      ) {
        server.close(CLOSE_CODES.limit, "too many streams");
      } else {
        const id = randomId();
        server.serializeAttachment({
          role: "phone",
          id,
          openedAt: Date.now(),
        } satisfies PhoneAttachment);
        send(host, { t: "open", id });
        await this.state.storage.setAlarm(Date.now() + PENDING_TIMEOUT_MS);
      }
    } else {
      const phone = this.state
        .getWebSockets("phone")
        .find((socket) => this.phoneId(socket) === route.id);
      const proven = await verifyRoomProof({
        room: route.room,
        key: url.searchParams.get("key") ?? "",
        sig: url.searchParams.get("sig") ?? "",
        message: acceptProofMessage(route.room, route.id),
      });
      if (phone === undefined || !proven) {
        this.state.acceptWebSocket(server, ["rejected"]);
        server.close(proven ? CLOSE_CODES.timeout : CLOSE_CODES.badProof, "refused");
      } else {
        this.state.acceptWebSocket(server, ["accept", `a:${route.id}`]);
        server.serializeAttachment({ role: "accept", id: route.id });
        for (const chunk of this.early.get(route.id) ?? []) server.send(chunk);
        this.early.delete(route.id);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private phoneId(socket: WebSocket): string | null {
    const attachment = this.attachment(socket);
    return attachment?.role === "phone" ? attachment.id : null;
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment === null) return;
    if (typeof message === "string") {
      if (attachment.role !== "host" || attachment.proven) return;
      const hello = parseControl<HostToRelay>(message, ["hello"]);
      const room = this.state.id.name ?? "";
      if (hello?.t !== "hello") return socket.close(CLOSE_CODES.protocol, "bad message");
      const proven = await verifyRoomProof({
        room,
        key: hello.key,
        sig: hello.sig,
        message: hostProofMessage(room, attachment.nonce),
      });
      if (!proven) return socket.close(CLOSE_CODES.badProof, "bad proof");
      // A computer that reconnects replaces its old socket.
      for (const other of this.state.getWebSockets("host")) {
        if (other !== socket) other.close(CLOSE_CODES.replaced, "replaced");
      }
      socket.serializeAttachment({ ...attachment, proven: true } satisfies HostAttachment);
      send(socket, { t: "ready" });
      return;
    }
    if (message.byteLength > MAX_MESSAGE_BYTES) return socket.close(CLOSE_CODES.limit, "too large");
    if (attachment.role === "accept") {
      const phone = this.state
        .getWebSockets("phone")
        .find((other) => this.phoneId(other) === attachment.id);
      phone?.send(message);
      return;
    }
    if (attachment.role === "phone") {
      const peer = this.state.getWebSockets(`a:${attachment.id}`)[0];
      if (peer !== undefined) return peer.send(message);
      const early = this.early.get(attachment.id) ?? [];
      early.push(message);
      if (early.reduce((sum, chunk) => sum + chunk.byteLength, 0) > MAX_EARLY_BYTES) {
        this.early.delete(attachment.id);
        return socket.close(CLOSE_CODES.limit, "too much early data");
      }
      this.early.set(attachment.id, early);
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment === null) return;
    if (attachment.role === "host") {
      if (!attachment.proven) return;
      // Streams already joined keep going; phones still waiting learn the computer is gone.
      for (const phone of this.state.getWebSockets("phone")) {
        const id = this.phoneId(phone);
        if (id !== null && this.state.getWebSockets(`a:${id}`).length === 0) {
          phone.close(CLOSE_CODES.hostOffline, "computer offline");
        }
      }
      return;
    }
    const id = attachment.id;
    this.early.delete(id);
    const peers =
      attachment.role === "phone"
        ? this.state.getWebSockets(`a:${id}`)
        : this.state.getWebSockets("phone").filter((other) => this.phoneId(other) === id);
    for (const peer of peers) peer.close(1000, "peer closed");
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  /** Phones the host never accepted, and computers that went silent. */
  async alarm(): Promise<void> {
    const now = Date.now();
    let next: number | null = null;
    for (const phone of this.state.getWebSockets("phone")) {
      const attachment = this.attachment(phone);
      if (attachment?.role !== "phone") continue;
      if (this.state.getWebSockets(`a:${attachment.id}`).length > 0) continue;
      const due = attachment.openedAt + PENDING_TIMEOUT_MS;
      if (due <= now) phone.close(CLOSE_CODES.timeout, "not accepted");
      else next = Math.min(next ?? due, due);
    }
    for (const host of this.state.getWebSockets("host")) {
      const pinged = this.state.getWebSocketAutoResponseTimestamp(host)?.getTime() ?? now;
      if (now - pinged > HOST_PING_MS * 3) host.close(CLOSE_CODES.timeout, "silent");
    }
    if (next !== null) await this.state.storage.setAlarm(next);
  }
}
