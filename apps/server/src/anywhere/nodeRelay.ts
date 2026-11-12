// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - A plain Node server, run on its own by `moonfold relay`.
/**
 * The Anywhere relay on Node (D-69): a small server anyone can run on a machine with a public
 * address. All protocol rules live in `RelayCore`; this file only moves WebSocket events into it.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeHttp from "node:http";

import {
  HOST_PING_MS,
  MAX_MESSAGE_BYTES,
  parseRelayPath,
  RelayCore,
  type RelaySocket,
  toBase64Url,
} from "@moonfold/shared/anywhereRelay";
import { type WebSocket, WebSocketServer } from "ws";

export interface NodeRelay {
  readonly port: number;
  readonly close: () => Promise<void>;
}

const randomId = () => toBase64Url(NodeCrypto.randomBytes(16));

export function startNodeRelay(input: {
  readonly port: number;
  readonly host?: string;
}): Promise<NodeRelay> {
  const core = new RelayCore({
    randomId,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  const sockets = new Map<WebSocket, RelaySocket>();
  const hostsHeardAt = new Map<WebSocket, number>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

  const server = NodeHttp.createServer((request, response) => {
    // A health check that says nothing about who uses the relay.
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "text/plain" }).end("ok\n");
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" }).end("Moonfold Anywhere relay\n");
  });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://relay");
    const route = parseRelayPath(url.pathname);
    if (route === null) {
      socket.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const relaySocket: RelaySocket = {
        send: (data) => {
          if (ws.readyState === ws.OPEN) ws.send(data, { binary: typeof data !== "string" });
        },
        close: (code, reason) => ws.close(code, reason),
      };
      sockets.set(ws, relaySocket);
      ws.on("message", (data, isBinary) => {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : data instanceof ArrayBuffer
            ? Buffer.from(data)
            : data;
        if (route.kind === "host" && !isBinary) {
          hostsHeardAt.set(ws, Date.now());
          void core.hostMessage(relaySocket, bytes.toString("utf8"));
          return;
        }
        if (isBinary) core.data(relaySocket, new Uint8Array(bytes));
      });
      ws.on("close", () => {
        sockets.delete(ws);
        hostsHeardAt.delete(ws);
        core.closed(relaySocket);
      });
      ws.on("error", () => ws.terminate());
      if (route.kind === "host") {
        hostsHeardAt.set(ws, Date.now());
        core.hostConnected(route.room, relaySocket);
      } else if (route.kind === "connect") {
        core.phoneConnected(route.room, relaySocket);
      } else {
        void core.hostAccepted(
          route.room,
          route.id,
          {
            key: url.searchParams.get("key") ?? "",
            sig: url.searchParams.get("sig") ?? "",
          },
          relaySocket,
        );
      }
    });
  });

  // A computer that stopped pinging is gone; its phones learn at once instead of on a timeout.
  const sweep = setInterval(() => {
    const cutoff = Date.now() - HOST_PING_MS * 3;
    for (const [ws, heardAt] of hostsHeardAt) if (heardAt < cutoff) ws.terminate();
  }, HOST_PING_MS);

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, input.host ?? "0.0.0.0", () => {
      server.off("error", reject);
      const address = server.address();
      resolve({
        port: typeof address === "object" && address !== null ? address.port : input.port,
        close: () =>
          new Promise<void>((done) => {
            clearInterval(sweep);
            for (const ws of sockets.keys()) ws.terminate();
            wss.close();
            server.close(() => done());
          }),
      });
    });
  });
}
