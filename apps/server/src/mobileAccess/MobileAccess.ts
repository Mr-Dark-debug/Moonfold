// @effect-diagnostics nodeBuiltinImport:off globalDate:off - One raw TLS listener beside the Node HTTP server.
/**
 * Mobile access (D-58): an HTTPS listener for the Moonfold Android app.
 *
 * While `mobileAccessEnabled` is on, the server also listens over TLS with a self-signed
 * certificate and serves the same handlers. The QR code carries the certificate's SHA-256 and
 * the app trusts only that certificate.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import type * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type * as NodeStream from "node:stream";

import type { AuthMobileAccessStatus } from "@moonfold/contracts";
import { DEFAULT_ANYWHERE_RELAY_URL } from "@moonfold/contracts/settings";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import {
  type AnywhereHost,
  type AnywhereKey,
  loadOrCreateAnywhereKey,
  normalizeRelayUrl,
  startAnywhereHost,
} from "../anywhere/anywhereHost.ts";

const CERTIFICATE_DAYS = 3650;
/** Tried in order from the main port + 1; the first free one is remembered in the state dir. */
const PORT_ATTEMPTS = 20;

/** The main HTTP server, kept by server.ts when it creates it. */
let mainHttpServer: NodeHttp.Server | null = null;
export const rememberMainHttpServer = <S extends NodeHttp.Server>(server: S): S => {
  mainHttpServer = server;
  return server;
};

export interface MobileCertificate {
  readonly key: string;
  readonly cert: string;
  readonly sha256: string;
}

/** Lowercase hex SHA-256 of a PEM certificate's DER bytes, as the app computes it. */
export function certificateSha256(certPem: string): string {
  return new NodeCrypto.X509Certificate(certPem).fingerprint256.replaceAll(":", "").toLowerCase();
}

/** Addresses another device could use: IPv4 outside loopback and link-local, LAN first. */
export function shareableAddresses(
  interfaces: ReturnType<typeof NodeOS.networkInterfaces>,
): ReadonlyArray<string> {
  const addresses = Object.values(interfaces)
    .flatMap((entries) => entries ?? [])
    .filter(
      (entry) =>
        entry.family === "IPv4" && !entry.internal && !entry.address.startsWith("169.254."),
    )
    .map((entry) => entry.address);
  const isTailnet = (address: string) => address.startsWith("100.");
  return [
    ...new Set([
      ...addresses.filter((address) => !isTailnet(address)),
      ...addresses.filter(isTailnet),
    ]),
  ];
}

// Just enough DER for one self-signed certificate; the app pins it, so nothing validates its chain.
const der = (tag: number, ...parts: ReadonlyArray<Buffer>): Buffer => {
  const body = Buffer.concat(parts);
  const length =
    body.length < 0x80
      ? Buffer.from([body.length])
      : body.length < 0x100
        ? Buffer.from([0x81, body.length])
        : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);
  return Buffer.concat([Buffer.from([tag]), length, body]);
};
const derSequence = (...parts: ReadonlyArray<Buffer>) => der(0x30, ...parts);
// ecdsa-with-SHA256 (1.2.840.10045.4.3.2)
const ECDSA_SHA256 = derSequence(Buffer.from("06082a8648ce3d040302", "hex"));
const COMMON_NAME = Buffer.from("0603550403", "hex"); // id-at-commonName (2.5.4.3)
const generalizedTime = (date: Date) =>
  der(0x18, Buffer.from(date.toISOString().replace(/[-:T]|\.\d+/g, ""), "ascii"));

/** A P-256 self-signed X.509 certificate, as PEM. */
export function generateSelfSignedCertificate(now: Date): {
  readonly key: string;
  readonly cert: string;
} {
  const { publicKey, privateKey } = NodeCrypto.generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const name = derSequence(
    der(0x31, derSequence(COMMON_NAME, der(0x0c, Buffer.from("Moonfold", "utf8")))),
  );
  const serial = NodeCrypto.randomBytes(16);
  serial[0] = serial[0]! & 0x7f; // A positive INTEGER.
  const tbs = derSequence(
    der(0xa0, der(0x02, Buffer.from([2]))), // X.509 v3
    der(0x02, serial),
    ECDSA_SHA256,
    name,
    derSequence(
      generalizedTime(now),
      generalizedTime(new Date(now.getTime() + CERTIFICATE_DAYS * 86_400_000)),
    ),
    name,
    publicKey.export({ type: "spki", format: "der" }),
  );
  const signature = NodeCrypto.sign("sha256", tbs, { key: privateKey, dsaEncoding: "der" });
  const certificate = derSequence(tbs, ECDSA_SHA256, der(0x03, Buffer.from([0]), signature));
  const lines = certificate.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert: ["-----BEGIN CERTIFICATE-----", ...lines, "-----END CERTIFICATE-----", ""].join("\n"),
  };
}

async function loadOrCreateCertificate(directory: string): Promise<MobileCertificate> {
  const keyPath = NodePath.join(directory, "key.pem");
  const certPath = NodePath.join(directory, "cert.pem");
  await NodeFSP.mkdir(directory, { recursive: true });
  const existing = await Promise.all([
    NodeFSP.readFile(keyPath, "utf8"),
    NodeFSP.readFile(certPath, "utf8"),
  ]).catch(() => null);
  if (existing !== null) {
    const [key, cert] = existing;
    return { key, cert, sha256: certificateSha256(cert) };
  }
  const generated = generateSelfSignedCertificate(new Date());
  await NodeFSP.writeFile(keyPath, generated.key, { mode: 0o600 });
  await NodeFSP.writeFile(certPath, generated.cert);
  return { ...generated, sha256: certificateSha256(generated.cert) };
}

const listen = (server: NodeHttps.Server, port: number) =>
  new Promise<boolean>((resolve) => {
    const onError = () => resolve(false);
    server.once("error", onError);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", onError);
      resolve(true);
    });
  });

async function startListener(input: {
  readonly directory: string;
  readonly mainPort: number;
}): Promise<{ readonly server: NodeHttps.Server; readonly status: AuthMobileAccessStatus }> {
  const main = mainHttpServer;
  if (main === null) throw new Error("The HTTP server is not running.");
  const certificate = await loadOrCreateCertificate(input.directory);
  const server = NodeHttps.createServer({ key: certificate.key, cert: certificate.cert });
  // The auth layer reads this header to mark cookies Secure and to name the issuer. Anything a
  // client sent is replaced, since this listener is the one that knows the transport.
  const markHttps = (request: NodeHttp.IncomingMessage) => {
    request.headers["x-forwarded-proto"] = "https";
  };
  server.on("request", (request, response) => {
    markHttps(request);
    main.emit("request", request, response);
  });
  server.on("upgrade", (request, socket: NodeStream.Duplex, head) => {
    markHttps(request);
    main.emit("upgrade", request, socket, head);
  });
  const portFile = NodePath.join(input.directory, "port");
  const remembered = Number((await NodeFSP.readFile(portFile, "utf8").catch(() => "")).trim());
  const candidates = [
    ...(Number.isInteger(remembered) && remembered > 0 ? [remembered] : []),
    ...Array.from({ length: PORT_ATTEMPTS }, (_, index) => input.mainPort + 1 + index),
  ];
  for (const port of candidates) {
    if (await listen(server, port)) {
      await NodeFSP.writeFile(portFile, String(port));
      return {
        server,
        status: {
          enabled: true,
          port,
          certificateSha256: certificate.sha256,
          addresses: shareableAddresses(NodeOS.networkInterfaces()),
        },
      };
    }
  }
  throw new Error("No free port for mobile access.");
}

const closeListener = (server: NodeHttps.Server) =>
  new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });

export const MOBILE_ACCESS_DISABLED: AuthMobileAccessStatus = {
  enabled: false,
  port: null,
  certificateSha256: null,
  addresses: [],
};

/** The second listener could not start: its certificate or port was unavailable. */
class MobileAccessStartError extends Schema.TaggedError<MobileAccessStartError>()(
  "MobileAccessStartError",
  { cause: Schema.Defect() },
) {}

export class MobileAccess extends Context.Service<
  MobileAccess,
  { readonly status: Effect.Effect<AuthMobileAccessStatus> }
>()("moonfold/mobileAccess/MobileAccess") {}

export const layer = Layer.effect(
  MobileAccess,
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const settings = yield* ServerSettings.ServerSettingsService;
    const running = yield* Ref.make<{
      readonly server: NodeHttps.Server;
      readonly status: AuthMobileAccessStatus;
    } | null>(null);
    const directory = NodePath.join(config.stateDir, "mobile-access");

    // Anywhere (D-69): the relay connection rides on the listener and stops with it.
    const anywhere = yield* Ref.make<{
      readonly relayUrl: string | null;
      readonly host: AnywhereHost | null;
      readonly room: string | null;
      readonly connected: boolean;
    } | null>(null);
    let anywhereKey: AnywhereKey | null = null;

    const stopAnywhere = Effect.gen(function* () {
      const current = yield* Ref.getAndSet(anywhere, null);
      current?.host?.stop();
    });

    const applyAnywhere = Effect.fn("MobileAccess.applyAnywhere")(function* (
      enabled: boolean,
      relaySetting: string | null,
    ) {
      const listener = yield* Ref.get(running);
      const relayUrl = normalizeRelayUrl(relaySetting ?? DEFAULT_ANYWHERE_RELAY_URL ?? "");
      const current = yield* Ref.get(anywhere);
      if (!enabled || listener === null || listener.status.port === null)
        return yield* stopAnywhere;
      if (current !== null && current.relayUrl === relayUrl) return;
      yield* stopAnywhere;
      if (relayUrl === null) {
        yield* Ref.set(anywhere, { relayUrl: null, host: null, room: null, connected: false });
        return;
      }
      const key = anywhereKey ?? (yield* Effect.promise(() => loadOrCreateAnywhereKey(directory)));
      anywhereKey = key;
      const services = yield* Effect.context<never>();
      const host = startAnywhereHost({
        relayUrl,
        key,
        targetPort: listener.status.port,
        onStatus: (status) =>
          Effect.runForkWith(services)(
            Ref.update(anywhere, (state) =>
              state === null || state.relayUrl !== relayUrl
                ? state
                : { ...state, connected: status.connected },
            ),
          ),
        onError: (message) =>
          Effect.runForkWith(services)(
            Effect.logWarning("Reach from anywhere: relay connection failed", { message }),
          ),
      });
      yield* Ref.set(anywhere, { relayUrl, host, room: key.room, connected: false });
      yield* Effect.logInfo("Reach from anywhere: connecting to relay", { relayUrl });
    });

    const stop = Effect.gen(function* () {
      yield* stopAnywhere;
      const current = yield* Ref.getAndSet(running, null);
      if (current !== null) yield* Effect.promise(() => closeListener(current.server));
    });
    const apply = Effect.fn("MobileAccess.apply")(
      function* (enabled: boolean) {
        const current = yield* Ref.get(running);
        if (enabled === (current !== null)) return;
        if (!enabled) return yield* stop;
        const started = yield* Effect.tryPromise({
          try: () => startListener({ directory, mainPort: config.port }),
          catch: (cause) => new MobileAccessStartError({ cause }),
        });
        yield* Ref.set(running, started);
        yield* Effect.logInfo("Mobile access listening", { port: started.status.port });
      },
      Effect.catch((error) =>
        Effect.logWarning("Mobile access could not start.", { cause: String(error.cause) }),
      ),
    );
    const applyAll = (current: {
      readonly mobileAccessEnabled: boolean;
      readonly anywhereEnabled: boolean;
      readonly anywhereRelayUrl: string | null;
    }) =>
      apply(current.mobileAccessEnabled).pipe(
        Effect.andThen(applyAnywhere(current.anywhereEnabled, current.anywhereRelayUrl)),
      );

    yield* Effect.addFinalizer(() => stop);
    // Starts a beat later than the server: the main listener must exist to receive requests.
    yield* settings.getSettings.pipe(
      Effect.flatMap(applyAll),
      Effect.delay("1 second"),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* settings.streamChanges.pipe(Stream.runForEach(applyAll), Effect.forkScoped);

    return {
      status: Ref.get(running).pipe(
        Effect.map((current) =>
          current === null
            ? MOBILE_ACCESS_DISABLED
            : {
                ...current.status,
                // Read fresh: the laptop may have moved to another network since it started.
                addresses: shareableAddresses(NodeOS.networkInterfaces()),
              },
        ),
        Effect.flatMap((status) =>
          Ref.get(anywhere).pipe(
            Effect.map((relay) =>
              relay === null || !status.enabled
                ? status
                : {
                    ...status,
                    anywhere: {
                      relayUrl: relay.relayUrl,
                      room: relay.room,
                      connected: relay.connected,
                    },
                  },
            ),
          ),
        ),
      ),
    };
  }),
);
