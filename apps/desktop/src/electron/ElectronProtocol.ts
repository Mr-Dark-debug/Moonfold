// @effect-diagnostics nodeBuiltinImport:off -- Hashes the inline scripts of served HTML for the CSP.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Mime from "effect/http/Mime";
import * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

export const DESKTOP_HOST = "app";
const DESKTOP_PRODUCTION_SCHEME = "moonfold";
const DESKTOP_DEVELOPMENT_SCHEME = "moonfold-dev";

export function getDesktopScheme(isDevelopment: boolean): string {
  return isDevelopment ? DESKTOP_DEVELOPMENT_SCHEME : DESKTOP_PRODUCTION_SCHEME;
}

function getDesktopOrigin(isDevelopment: boolean): string {
  return `${getDesktopScheme(isDevelopment)}://${DESKTOP_HOST}`;
}

export function getDesktopUrl(isDevelopment: boolean): string {
  return `${getDesktopOrigin(isDevelopment)}/`;
}

export class ElectronProtocolRegistrationError extends Schema.TaggedError<ElectronProtocolRegistrationError>()(
  "ElectronProtocolRegistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to register Electron protocol scheme "${this.scheme}".`;
  }
}

export class ElectronProtocolUnregistrationError extends Schema.TaggedError<ElectronProtocolUnregistrationError>()(
  "ElectronProtocolUnregistrationError",
  {
    scheme: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to unregister Electron protocol scheme "${this.scheme}".`;
  }
}

export type DesktopProtocolRegistrationInput = {
  readonly scheme: string;
  readonly clerkFrontendApiHostname: string | undefined;
} & ({ readonly targetOrigin: URL } | { readonly assetDirectory: string });

export class ElectronProtocol extends Context.Service<
  ElectronProtocol,
  {
    readonly registerDesktopProtocol: (
      input: DesktopProtocolRegistrationInput,
    ) => Effect.Effect<void, ElectronProtocolRegistrationError, Scope.Scope>;
  }
>()("@moonfold/desktop/electron/ElectronProtocol") {}

/**
 * `'sha256-…'` sources for the inline `<script>` elements of an HTML document, so the renderer
 * runs exactly the inline scripts it was served (the theme boot script, and Vite's preamble in
 * development) and no injected one.
 */
export function inlineScriptHashes(html: string): ReadonlyArray<string> {
  const hashes = new Set<string>();
  for (const match of html.matchAll(/<script(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1] ?? "";
    if (body.trim() === "") continue;
    hashes.add(`'sha256-${NodeCrypto.createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...hashes];
}

function makeDesktopContentSecurityPolicy(
  input: DesktopProtocolRegistrationInput,
  scriptHashes: ReadonlyArray<string> = [],
): string {
  const clerkOrigin = input.clerkFrontendApiHostname
    ? `https://${input.clerkFrontendApiHostname}`
    : undefined;
  // Clerk and its Turnstile challenge load only in builds configured for a self-hosted relay.
  const scriptSources = [
    "'self'",
    ...scriptHashes,
    "'wasm-unsafe-eval'",
    ...(clerkOrigin ? [clerkOrigin, "https://challenges.cloudflare.com"] : []),
  ];

  // User-configured environment origins are unknown here, so allow supported network schemes.
  // GLTFLoader fetches embedded textures through blob URLs.
  const connectSources = ["'self'", "blob:", "http:", "https:", "ws:", "wss:"];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    `connect-src ${connectSources.join(" ")}`,
    `img-src 'self' ${input.scheme}: blob: data: http: https:`,
    `media-src 'self' ${input.scheme}: blob: http: https:`,
    "style-src 'self' 'unsafe-inline'",
    `font-src 'self' ${input.scheme}: data:`,
    "worker-src 'self' blob:",
    "frame-src 'self' blob: http: https:",
    "object-src 'self' blob: http: https:",
    "form-action 'self'",
  ].join("; ");
}

/** Adds the CSP; an HTML document's policy also allows exactly its own inline scripts. */
async function withContentSecurityPolicy(
  response: Response,
  input: DesktopProtocolRegistrationInput,
): Promise<Response> {
  const headers = new Headers(response.headers);
  const isHtml = headers.get("content-type")?.toLowerCase().includes("text/html") ?? false;
  if (!isHtml || response.body === null) {
    headers.set("Content-Security-Policy", makeDesktopContentSecurityPolicy(input));
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  const html = await response.text();
  headers.set(
    "Content-Security-Policy",
    makeDesktopContentSecurityPolicy(input, inlineScriptHashes(html)),
  );
  headers.delete("content-length");
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}

// Must run synchronously before Electron emits ready.
function registerDesktopSchemePrivilegesSync(): void {
  Electron.protocol.registerSchemesAsPrivileged([
    {
      scheme: DESKTOP_PRODUCTION_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        // Custom schemes must opt into V8 caching; dev URLs serve changing code.
        codeCache: true,
      },
    },
    {
      scheme: DESKTOP_DEVELOPMENT_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

const registerDesktopSchemePrivileges = Effect.sync(registerDesktopSchemePrivilegesSync).pipe(
  Effect.withSpan("desktop.electron.protocol.registerSchemePrivileges"),
);

export const layerSchemePrivileges = Layer.effectDiscard(registerDesktopSchemePrivileges);

class ElectronProtocolFetchError extends Schema.TaggedError<ElectronProtocolFetchError>()(
  "ElectronProtocolFetchError",
  { cause: Schema.Defect() },
) {}

const netFetch = (url: string, init: RequestInit) =>
  Effect.tryPromise({
    try: () => Electron.net.fetch(url, init),
    catch: (cause) => new ElectronProtocolFetchError({ cause }),
  });

const fetchWithTransientRetry = (url: string, init: RequestInit) =>
  netFetch(url, init).pipe(
    Effect.retry({ schedule: Schedule.exponential("50 millis", 3), times: 2 }),
  );

const proxyRequest = Effect.fn("desktop.protocol.proxyRequest")(function* (
  request: Request,
  targetOrigin: URL,
  input: DesktopProtocolRegistrationInput,
) {
  const requestUrl = new URL(request.url);
  if (requestUrl.host !== DESKTOP_HOST) {
    return new Response(null, { status: 404 });
  }

  // Assign the path so leading slashes cannot replace the configured host.
  const targetUrl = new URL(targetOrigin);
  targetUrl.pathname = requestUrl.pathname;
  targetUrl.search = requestUrl.search;
  const headers = new Headers(request.headers);
  const headersToRemove: string[] = [];
  for (const name of headers.keys()) {
    if (
      name === "host" ||
      name === "origin" ||
      name === "referer" ||
      name === "connection" ||
      name === "content-length" ||
      name === "accept-encoding" ||
      name === "upgrade-insecure-requests" ||
      name.startsWith("sec-fetch-")
    ) {
      headersToRemove.push(name);
    }
  }
  for (const name of headersToRemove) {
    headers.delete(name);
  }
  const init: RequestInit = {
    method: request.method,
    headers,
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as RequestInit & { duplex: "half" }).duplex = "half";
  }
  const response =
    request.method === "GET" || request.method === "HEAD"
      ? yield* fetchWithTransientRetry(targetUrl.toString(), init)
      : yield* netFetch(targetUrl.toString(), init);
  return yield* Effect.promise(() => withContentSecurityPolicy(response, input));
});

const serveDesktopAsset = Effect.fn("desktop.protocol.serveAsset")(function* (
  request: Request,
  assetDirectory: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const url = new URL(request.url);
  if (url.host !== DESKTOP_HOST) return new Response(null, { status: 404 });
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const pathname = Option.getOrNull(Option.liftThrowable(decodeURIComponent)(url.pathname));
  if (pathname === null || pathname.includes("\0")) return new Response(null, { status: 400 });
  const root = path.resolve(assetDirectory);
  const assetPath = path.resolve(root, `.${pathname}`);
  if (assetPath !== root && !assetPath.startsWith(root + path.sep)) {
    return new Response(null, { status: 404 });
  }
  const stat = yield* fileSystem.stat(assetPath).pipe(Effect.orElseSucceed(() => null));
  let filePath = assetPath;
  if (stat?.type !== "File") {
    const wantsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
    if (path.extname(assetPath) !== "" && !wantsHtml) {
      return new Response(null, { status: 404 });
    }
    filePath = path.join(root, "index.html");
  }
  const contents = yield* fileSystem.readFile(filePath).pipe(Effect.orElseSucceed(() => null));
  if (contents === null) return new Response(null, { status: 404 });
  return new Response(request.method === "HEAD" ? null : new Uint8Array(contents), {
    headers: {
      "content-type": Option.getOrElse(Mime.getType(filePath), () => "application/octet-stream"),
    },
  });
});

/** @public */
export const make = Effect.gen(function* () {
  const registered = yield* Ref.make(false);
  const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();
  const runPromise = Effect.runPromiseWith(context);

  const registerDesktopProtocol = Effect.fn("desktop.electron.protocol.registerDesktopProtocol")(
    function* (input: DesktopProtocolRegistrationInput) {
      if (yield* Ref.get(registered)) return;

      yield* Effect.acquireRelease(
        Effect.try({
          try: () => {
            Electron.protocol.handle(input.scheme, async (request) => {
              if ("assetDirectory" in input) {
                return withContentSecurityPolicy(
                  await runPromise(serveDesktopAsset(request, input.assetDirectory)),
                  input,
                );
              }
              return runPromise(
                proxyRequest(request, input.targetOrigin, input).pipe(
                  Effect.catchTags({
                    ElectronProtocolFetchError: (error) => Effect.die(error.cause),
                  }),
                ),
              );
            });
          },
          catch: (cause) => new ElectronProtocolRegistrationError({ scheme: input.scheme, cause }),
        }).pipe(Effect.andThen(Ref.set(registered, true))),
        () =>
          Effect.try({
            try: () => Electron.protocol.unhandle(input.scheme),
            catch: (cause) =>
              new ElectronProtocolUnregistrationError({
                scheme: input.scheme,
                cause,
              }),
          }).pipe(Effect.andThen(Ref.set(registered, false)), Effect.orDie),
      );
    },
  );

  return ElectronProtocol.of({ registerDesktopProtocol });
});

export const layer = Layer.effect(ElectronProtocol, make);
