/**
 * Local models for Pi (D-56): Ollama and LM Studio servers on this machine, probed on loopback
 * only and never started or configured. A Moonfold-owned Pi extension registers them per process.
 *
 * @module provider-pi/server/localModels
 */
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

export const MOONFOLD_PI_LOCAL_PROVIDERS_ENV = "MOONFOLD_PI_LOCAL_PROVIDERS";
const PI_LOCAL_MODELS_EXTENSION_FILENAME = "pi-moonfold-local-models.ts";

export interface LocalModelServerDefinition {
  /** Pi provider id; models show as `<id>/<model>`. */
  readonly id: string;
  readonly name: string;
  /** OpenAI-compatible base URL, on loopback. */
  readonly baseUrl: string;
}

export interface LocalModelServer extends LocalModelServerDefinition {
  readonly models: ReadonlyArray<string>;
}

const LOCAL_MODEL_SERVERS: ReadonlyArray<LocalModelServerDefinition> = [
  { id: "ollama-local", name: "Ollama (local)", baseUrl: "http://127.0.0.1:11434/v1" },
  { id: "lmstudio-local", name: "LM Studio (local)", baseUrl: "http://127.0.0.1:1234/v1" },
];

const DETECT_TIMEOUT_MS = 1_500;
const MAX_MODELS_PER_SERVER = 200;

/** Model ids from an OpenAI-compatible `GET /models` body; anything unexpected yields none. */
export function parseOpenAiModelList(body: unknown): ReadonlyArray<string> {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const ids = data
    .map((entry) =>
      typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined,
    )
    .filter(
      (id): id is string =>
        typeof id === "string" && id.length > 0 && id.length <= 200 && !/\s/.test(id),
    );
  return [...new Set(ids)].slice(0, MAX_MODELS_PER_SERVER);
}

/**
 * The local servers that answer right now, with their models. A server that is not running,
 * answers slowly or returns something unexpected is simply absent.
 */
export const detectLocalModelServers = Effect.fn("detectLocalModelServers")(function* (
  servers: ReadonlyArray<LocalModelServerDefinition> = LOCAL_MODEL_SERVERS,
) {
  const http = yield* HttpClient.HttpClient;
  const found = yield* Effect.forEach(
    servers,
    (server) =>
      http.execute(HttpClientRequest.get(`${server.baseUrl}/models`)).pipe(
        Effect.flatMap((response) => (response.status === 200 ? response.json : Effect.undefined)),
        Effect.map((body) => {
          const models = parseOpenAiModelList(body);
          return models.length === 0 ? null : { ...server, models };
        }),
        Effect.timeout(DETECT_TIMEOUT_MS),
        Effect.orElseSucceed(() => null),
      ),
    { concurrency: "unbounded" },
  );
  return found.filter((server) => server !== null);
});

/** The env value the extension reads: only what it needs, so nothing else leaks into Pi. */
function localProvidersEnvValue(servers: ReadonlyArray<LocalModelServer>): string {
  return JSON.stringify(
    servers.map((server) => ({
      id: server.id,
      name: server.name,
      baseUrl: server.baseUrl,
      models: server.models,
    })),
  );
}

/**
 * Registers the servers listed in the env as Pi providers. Plain TypeScript with no imports, so
 * Pi can load it from the cache directory without resolving any package.
 */
export const PI_LOCAL_MODELS_EXTENSION_SOURCE = `\
// Written by Moonfold. Registers local model servers (Ollama, LM Studio) for this Pi process.
const ENV = ${JSON.stringify(MOONFOLD_PI_LOCAL_PROVIDERS_ENV)};

export default function (pi: { registerProvider: (name: string, config: unknown) => void }) {
  let servers: Array<{ id: string; name: string; baseUrl: string; models: string[] }> = [];
  try {
    servers = JSON.parse(process.env[ENV] ?? "[]");
  } catch {
    return;
  }
  for (const server of servers) {
    if (!Array.isArray(server.models) || server.models.length === 0) continue;
    pi.registerProvider(server.id, {
      name: server.name,
      baseUrl: server.baseUrl,
      // Local servers ignore the key; Pi needs one to treat the models as available.
      apiKey: "local",
      api: "openai-completions",
      models: server.models.map((id) => ({
        type: "chat",
        id,
        name: id,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 32768,
        maxTokens: 8192,
      })),
    });
  }
}
`;

/** Writes the extension into the cache directory when it is missing or out of date. */
export const materializePiLocalModelsExtension = Effect.fn("materializePiLocalModelsExtension")(
  function* (cacheDir: string) {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(cacheDir, { recursive: true });
    const dest = `${cacheDir.replace(/\\/g, "/")}/${PI_LOCAL_MODELS_EXTENSION_FILENAME}`;
    const existing = yield* fs.readFileString(dest).pipe(Effect.orElseSucceed(() => ""));
    if (existing !== PI_LOCAL_MODELS_EXTENSION_SOURCE) {
      yield* fs.writeFileString(dest, PI_LOCAL_MODELS_EXTENSION_SOURCE);
    }
    return dest;
  },
);

/** Launch args and env that load the extension, or nothing when no local server is running. */
export function localModelsLaunch(
  extensionPath: string | undefined,
  servers: ReadonlyArray<LocalModelServer>,
): { readonly args: ReadonlyArray<string>; readonly env: Record<string, string> } {
  if (extensionPath === undefined || servers.length === 0) return { args: [], env: {} };
  return {
    args: ["--extension", extensionPath],
    env: { [MOONFOLD_PI_LOCAL_PROVIDERS_ENV]: localProvidersEnvValue(servers) },
  };
}
