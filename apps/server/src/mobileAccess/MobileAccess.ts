// @effect-diagnostics nodeBuiltinImport:off globalDate:off - One raw TLS listener beside the Node HTTP server.
/**
 * Mobile access (D-58): an HTTPS listener for the Moonfold Android app.
 *
 * While the `mobileAccessEnabled` setting is on, the server also listens on every interface over
 * TLS with a self-signed certificate. Requests and WebSocket upgrades go to the same handlers as
 * the main HTTP server, so auth, scopes and every route behave the same. The QR code carries the
 * certificate's SHA-256 and the app trusts that certificate only, which gives encryption and host
 * identity without a certificate authority, a domain or any hosted service.
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import type * as NodeHttp from "node:http";
import * as NodeHttps from "node:https";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import type * as NodeStream from "node:stream";

import type { AuthMobileAccessStatus } from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";

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

    const stop = Effect.gen(function* () {
      const current = yield* Ref.getAndSet(running, null);
      if (current !== null) yield* Effect.promise(() => closeListener(current.server));
    });
    const apply = (enabled: boolean) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(running);
        if (enabled === (current !== null)) return;
        if (!enabled) return yield* stop;
        const started = yield* Effect.tryPromise(() =>
          startListener({ directory, mainPort: config.port }),
        );
        yield* Ref.set(running, started);
        yield* Effect.logInfo("Mobile access listening", { port: started.status.port });
      }).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Mobile access could not start.", { cause: String(cause) }),
        ),
      );

    yield* Effect.addFinalizer(() => stop);
    // Starts a beat later than the server: the main listener must exist to receive requests.
    yield* settings.getSettings.pipe(
      Effect.flatMap((current) => apply(current.mobileAccessEnabled)),
      Effect.delay("1 second"),
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* settings.streamChanges.pipe(
      Stream.runForEach((current) => apply(current.mobileAccessEnabled)),
      Effect.forkScoped,
    );

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
      ),
    };
  }),
);
