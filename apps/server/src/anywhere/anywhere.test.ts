// @effect-diagnostics nodeBuiltinImport:off globalTimers:off globalDate:off - Real sockets: relay, computer and phone in one process.
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeTls from "node:tls";

import { CLOSE_CODES } from "@moonfold/shared/anywhereRelay";
import { describe, expect, it } from "vite-plus/test";

import { certificateSha256, generateSelfSignedCertificate } from "../mobileAccess/MobileAccess.ts";
import {
  type AnywhereHostStatus,
  loadOrCreateAnywhereKey,
  normalizeRelayUrl,
  startAnywhereHost,
} from "./anywhereHost.ts";
import { startNodeRelay } from "./nodeRelay.ts";

/** Resolves on the first status the predicate accepts. */
function statusWatcher() {
  let waiting: Array<{ test: (s: AnywhereHostStatus) => boolean; done: () => void }> = [];
  return {
    onStatus: (status: AnywhereHostStatus) => {
      waiting = waiting.filter((entry) => {
        if (!entry.test(status)) return true;
        entry.done();
        return false;
      });
    },
    until: (test: (s: AnywhereHostStatus) => boolean) =>
      new Promise<void>((done) => waiting.push({ test, done })),
  };
}

/**
 * The phone's local proxy in miniature: a TCP listener whose connections each become one relay
 * stream. The test then speaks TLS to it, as the web view does.
 */
async function phoneProxy(relayUrl: string, room: string) {
  const server = NodeNet.createServer((socket) => {
    const stream = new WebSocket(`${relayUrl}/v1/connect/${room}`);
    stream.binaryType = "arraybuffer";
    const early: Array<Buffer> = [];
    stream.addEventListener("open", () => {
      for (const chunk of early.splice(0)) stream.send(chunk);
    });
    stream.addEventListener("message", (event) => {
      if (event.data instanceof ArrayBuffer) socket.write(Buffer.from(event.data));
    });
    stream.addEventListener("close", () => socket.destroy());
    socket.on("data", (chunk) =>
      stream.readyState === WebSocket.OPEN ? stream.send(chunk) : early.push(chunk),
    );
    socket.on("close", () => stream.close());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as NodeNet.AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>((done) => server.close(() => done())),
  };
}

describe("Anywhere", () => {
  it("carries a TLS session from the phone to the computer without ending it at the relay", async () => {
    const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "moonfold-anywhere-"));
    const certificate = generateSelfSignedCertificate(new Date(Date.UTC(2026, 10, 1)));
    // The computer's mobile HTTPS port, answering one line.
    const target = NodeTls.createServer(
      { key: certificate.key, cert: certificate.cert },
      (socket) => socket.end("hello from the computer\n"),
    );
    await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve));
    const relay = await startNodeRelay({ port: 0, host: "127.0.0.1" });
    const relayUrl = normalizeRelayUrl(`ws://127.0.0.1:${relay.port}/`)!;
    const key = await loadOrCreateAnywhereKey(directory);
    const watcher = statusWatcher();
    const host = startAnywhereHost({
      relayUrl,
      key,
      targetPort: (target.address() as NodeNet.AddressInfo).port,
      onStatus: watcher.onStatus,
    });
    const proxy = await phoneProxy(relayUrl, key.room);
    try {
      await watcher.until((status) => status.connected);
      const reply = await new Promise<{ text: string; fingerprint: string }>((resolve, reject) => {
        // The phone pins the certificate from its QR code; TLS name checks do not apply.
        const socket = NodeTls.connect({
          host: "127.0.0.1",
          port: proxy.port,
          rejectUnauthorized: false,
        });
        let text = "";
        socket.on("data", (chunk) => (text += chunk.toString()));
        socket.on("end", () =>
          resolve({ text, fingerprint: socket.getPeerCertificate().fingerprint256 }),
        );
        socket.on("error", reject);
      });
      expect(reply.text).toBe("hello from the computer\n");
      // The certificate the phone saw is the computer's own: the relay held no key.
      expect(reply.fingerprint.replaceAll(":", "").toLowerCase()).toBe(
        certificateSha256(certificate.cert),
      );

      // The same key is reused, so the room in a phone's pairing stays valid.
      expect((await loadOrCreateAnywhereKey(directory)).room).toBe(key.room);
    } finally {
      host.stop();
      await proxy.close();
      await relay.close();
      await new Promise<void>((done) => target.close(() => done()));
      await NodeFSP.rm(directory, { recursive: true, force: true });
    }
  });

  it("tells a phone the computer is offline", async () => {
    const relay = await startNodeRelay({ port: 0, host: "127.0.0.1" });
    try {
      const closed = await new Promise<number>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${relay.port}/v1/connect/${"A".repeat(43)}`);
        socket.addEventListener("close", (event) => resolve(event.code));
      });
      expect(closed).toBe(CLOSE_CODES.hostOffline);
    } finally {
      await relay.close();
    }
  });

  it("accepts only websocket relay addresses without credentials or queries", () => {
    expect(normalizeRelayUrl("wss://relay.example.dev/")).toBe("wss://relay.example.dev");
    expect(normalizeRelayUrl(" wss://example.dev/anywhere// ")).toBe("wss://example.dev/anywhere");
    expect(normalizeRelayUrl("https://relay.example.dev")).toBeNull();
    expect(normalizeRelayUrl("wss://user:pw@relay.example.dev")).toBeNull();
    expect(normalizeRelayUrl("wss://relay.example.dev/?token=1")).toBeNull();
    expect(normalizeRelayUrl("not a url")).toBeNull();
  });
});
