/**
 * PluginStore - plugins installed in Moonfold: `SKILL.md` skills and optional MCP servers, read
 * from Codex and Claude Code plugin folders as they are. Plugins start disabled, so their MCP
 * commands are shown to the user before anything runs.
 *
 * @module plugins/PluginStore
 */
import {
  type InstalledPlugin,
  PluginError,
  PluginId,
  type PluginListResult,
  type PluginMcpServer,
  type PluginSkill,
  type PluginSource,
} from "@moonfold/contracts";
import {
  EMPTY_PROVIDER_PLUGIN_BUNDLE,
  type ProviderPluginBundle,
  ProviderPlugins,
} from "@moonfold/provider-core/server/ProviderPlugins";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../config.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

type PluginFormat = InstalledPlugin["formats"][number];

interface PluginScan {
  readonly name: string;
  readonly version: string | null;
  readonly description: string | null;
  readonly formats: ReadonlyArray<PluginFormat>;
  /** Absolute folder of each skill (the folder holding its SKILL.md). */
  readonly skillDirs: ReadonlyArray<{ readonly dir: string; readonly skill: PluginSkill }>;
  readonly mcpServers: ReadonlyArray<PluginMcpServer>;
}

const RegistryEntry = Schema.Struct({
  id: Schema.String,
  source: Schema.Unknown,
  enabled: Schema.Boolean,
  installedAt: Schema.String,
  updatedAt: Schema.String,
  plugin: Schema.Unknown,
  env: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
});
const Registry = Schema.Struct({ plugins: Schema.Array(RegistryEntry) });
type RegistryEntry = typeof RegistryEntry.Type;
const decodeRegistry = Schema.decodeUnknownEffect(Schema.fromJsonString(Registry));
const encodeRegistry = Schema.encodeEffect(Schema.fromJsonString(Registry));
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown));
const isPluginError = Schema.is(PluginError);

/**
 * Whether an update kept every MCP server the same: same programs, arguments, places and
 * environment, so nothing runs that the user did not see when enabling the plugin.
 */
function sameMcpServers(
  left: ReadonlyArray<PluginMcpServer>,
  right: ReadonlyArray<PluginMcpServer>,
): boolean {
  const key = (server: PluginMcpServer) =>
    [
      server.name,
      server.command,
      ...server.args,
      server.cwd,
      server.url,
      ...server.envVars,
      ...Object.entries(server.env ?? {})
        .toSorted(([a], [b]) => a.localeCompare(b))
        .flat(),
    ].join("\u0000");
  return (
    left.length === right.length &&
    left.every((server, index) => key(server) === key(right[index]!))
  );
}

/** Frontmatter `name` and `description` of a SKILL.md, read without a YAML dependency. */
export function readSkillFrontmatter(content: string): {
  readonly name: string | null;
  readonly description: string | null;
} {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (match === null) return { name: null, description: null };
  const field = (key: string) => {
    const line = new RegExp(`^${key}:\\s*(.+)$`, "m").exec(match[1] ?? "");
    const value = line?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
    return value.length > 0 ? value : null;
  };
  return { name: field("name"), description: field("description") };
}

/** A folder or display name as a plugin id: lowercase letters, digits, dots, dashes. */
export function pluginIdFrom(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/\.git$/, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .slice(0, 64)
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  return slug.length > 0 ? slug : "plugin";
}

const PLUGIN_ROOT_TOKEN = "${CLAUDE_PLUGIN_ROOT}";

/** A path a plugin names that stays inside its own folder: relative, with no `..` step. */
export function staysInsidePlugin(value: string): boolean {
  const relative = value.startsWith(PLUGIN_ROOT_TOKEN)
    ? value.slice(PLUGIN_ROOT_TOKEN.length).replace(/^[\\/]+/, "")
    : value;
  return !/^([a-zA-Z]:|[\\/])/.test(relative) && !relative.split(/[\\/]/).includes("..");
}

/** A git URL with any user name, password or token removed, for showing and messages. */
export function withoutUrlCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]*@/i, "$1");
}

/**
 * Reads the MCP servers a plugin's `.mcp.json` declares, in either Codex's or Claude Code's
 * form, resolving working directories and `${CLAUDE_PLUGIN_ROOT}` against the plugin folder.
 * A server whose working directory leaves the plugin folder is left out.
 */
export function parsePluginMcpConfig(
  json: unknown,
  pluginRoot: string,
  join: (...parts: ReadonlyArray<string>) => string,
): ReadonlyArray<PluginMcpServer> {
  if (json === null || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  const servers = (
    record.mcpServers && typeof record.mcpServers === "object" ? record.mcpServers : record
  ) as Record<string, unknown>;
  const resolveRoot = (value: string) => value.replaceAll("${CLAUDE_PLUGIN_ROOT}", pluginRoot);
  return Object.entries(servers).flatMap(([name, raw]) => {
    if (raw === null || typeof raw !== "object") return [];
    const server = raw as Record<string, unknown>;
    if (server.enabled === false) return [];
    const strings = (value: unknown) =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const command = typeof server.command === "string" ? resolveRoot(server.command) : null;
    const url = typeof server.url === "string" ? server.url : null;
    if (command === null && url === null) return [];
    if (typeof server.cwd === "string" && !staysInsidePlugin(server.cwd)) return [];
    const env =
      server.env && typeof server.env === "object"
        ? Object.fromEntries(
            Object.entries(server.env as Record<string, unknown>).flatMap(([key, value]) =>
              typeof value === "string" ? [[key, resolveRoot(value)]] : [],
            ),
          )
        : {};
    return [
      {
        name,
        command,
        args: strings(server.args).map(resolveRoot),
        cwd:
          command === null
            ? null
            : typeof server.cwd === "string"
              ? join(pluginRoot, resolveRoot(server.cwd))
              : pluginRoot,
        url,
        envVars: strings(server.env_vars),
        env,
      },
    ];
  });
}

/** Accepts https, ssh and `user@host:path` remotes; refuses option-like and helper transports. */
export function isAllowedGitUrl(url: string): boolean {
  if (url.startsWith("-")) return false;
  if (/^(https|ssh):\/\//i.test(url)) return true;
  return /^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(url);
}

export class PluginStore extends Context.Service<
  PluginStore,
  {
    readonly list: Effect.Effect<PluginListResult, PluginError>;
    readonly install: (source: PluginSource) => Effect.Effect<InstalledPlugin, PluginError>;
    readonly update: (id: PluginId) => Effect.Effect<InstalledPlugin, PluginError>;
    readonly setEnabled: (
      id: PluginId,
      enabled: boolean,
    ) => Effect.Effect<InstalledPlugin, PluginError>;
    readonly remove: (id: PluginId) => Effect.Effect<void, PluginError>;
    /** What enabled plugins give a provider session. */
    readonly bundle: Effect.Effect<ProviderPluginBundle>;
  }
>()("moonfold/plugins/PluginStore") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const { pluginsDir } = yield* ServerConfig.ServerConfig;
  const registryPath = path.join(pluginsDir, "registry.json");
  // Installs, updates and removals change the registry and folders together, one at a time.
  const lock = yield* Semaphore.make(1);

  const fail = (message: string) => (cause: unknown) => new PluginError({ message, cause });

  const readJson = (file: string) =>
    fs.readFileString(file).pipe(
      Effect.flatMap(decodeJson),
      Effect.orElseSucceed((): unknown => null),
    );

  const exists = (file: string) => fs.exists(file).pipe(Effect.orElseSucceed(() => false));

  /** Folders holding a SKILL.md: the root, `skills/**`, or top-level folders without `skills/`. */
  const findSkillDirs = Effect.fn("PluginStore.findSkillDirs")(function* (root: string) {
    const dirs: Array<string> = [];
    if (yield* exists(path.join(root, "SKILL.md"))) dirs.push(root);
    const skillsRoot = path.join(root, "skills");
    const searchRoot = (yield* exists(skillsRoot)) ? skillsRoot : root;
    const entries = yield* fs
      .readDirectory(searchRoot, { recursive: true })
      .pipe(Effect.orElseSucceed(() => [] as Array<string>));
    for (const entry of entries) {
      const normalized = entry.replaceAll("\\", "/");
      if (!normalized.endsWith("/SKILL.md") && normalized !== "SKILL.md") continue;
      if (normalized.split("/").some((part) => part === "node_modules" || part === ".git"))
        continue;
      // Without a skills folder, only top-level skill folders count.
      if (searchRoot === root && normalized.split("/").length !== 2) continue;
      const dir = path.dirname(path.join(searchRoot, normalized));
      if (!dirs.includes(dir)) dirs.push(dir);
    }
    return dirs;
  });

  const scan = Effect.fn("PluginStore.scan")(function* (root: string, fallbackName: string) {
    const codexManifest = yield* readJson(path.join(root, ".codex-plugin", "plugin.json"));
    const claudeManifest = yield* readJson(path.join(root, ".claude-plugin", "plugin.json"));
    const manifest = (codexManifest ?? claudeManifest ?? {}) as Record<string, unknown>;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);
    const skillDirs = yield* Effect.forEach(yield* findSkillDirs(root), (dir) =>
      fs.readFileString(path.join(dir, "SKILL.md")).pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((content) => {
          const frontmatter = readSkillFrontmatter(content);
          return {
            dir,
            skill: {
              name: frontmatter.name ?? path.basename(dir),
              description: frontmatter.description,
              path: path.join(dir, "SKILL.md"),
            },
          };
        }),
      ),
    );
    // A manifest may name its MCP config, but only one inside the plugin folder.
    const mcpConfigPath =
      typeof manifest.mcpServers === "string" && staysInsidePlugin(manifest.mcpServers)
        ? path.join(root, manifest.mcpServers)
        : path.join(root, ".mcp.json");
    const mcpServers = parsePluginMcpConfig(yield* readJson(mcpConfigPath), root, (...parts) =>
      path.join(...parts),
    );
    const formats: Array<PluginFormat> = [];
    if (codexManifest !== null) formats.push("codex");
    if (claudeManifest !== null) formats.push("claude");
    if (formats.length === 0) formats.push("skills");
    return {
      name: text(manifest.name) ?? fallbackName,
      version: text(manifest.version),
      description: text(manifest.description),
      formats,
      skillDirs,
      mcpServers,
    } satisfies PluginScan;
  });

  const readRegistry = Effect.gen(function* () {
    if (!(yield* exists(registryPath))) return [] as Array<RegistryEntry>;
    const text = yield* fs
      .readFileString(registryPath)
      .pipe(Effect.mapError(fail("Could not read the plugin registry.")));
    const registry = yield* decodeRegistry(text).pipe(
      Effect.mapError(fail("The plugin registry is not valid.")),
    );
    return [...registry.plugins];
  });

  const writeRegistry = (entries: ReadonlyArray<RegistryEntry>) =>
    fs.makeDirectory(pluginsDir, { recursive: true }).pipe(
      Effect.andThen(encodeRegistry({ plugins: entries })),
      Effect.flatMap((text) => fs.writeFileString(registryPath, `${text}\n`)),
      Effect.mapError(fail("Could not save the plugin registry.")),
    );

  const toInstalled = (entry: RegistryEntry): InstalledPlugin =>
    ({
      ...(entry.plugin as Omit<InstalledPlugin, "enabled" | "installedAt" | "updatedAt">),
      // Registries written before env was shown keep it beside the plugin.
      mcpServers: (entry.plugin as Pick<InstalledPlugin, "mcpServers">).mcpServers.map(
        (server) => ({
          ...server,
          env: server.env ?? entry.env?.[server.name] ?? {},
        }),
      ),
      enabled: entry.enabled,
      installedAt: entry.installedAt,
      updatedAt: entry.updatedAt,
    }) as InstalledPlugin;

  /** Copies each skill into `view/skills` and writes the Claude Code manifest there. */
  const buildView = Effect.fn("PluginStore.buildView")(function* (
    id: string,
    pluginScan: PluginScan,
  ) {
    const view = path.join(pluginsDir, id, "view");
    yield* fs.remove(view, { recursive: true }).pipe(Effect.ignore);
    yield* fs.makeDirectory(path.join(view, "skills"), { recursive: true });
    const used = new Set<string>();
    for (const { dir, skill } of pluginScan.skillDirs) {
      let folder = pluginIdFrom(skill.name);
      for (let suffix = 2; used.has(folder); suffix += 1)
        folder = `${pluginIdFrom(skill.name)}-${suffix}`;
      used.add(folder);
      yield* fs.copy(dir, path.join(view, "skills", folder), { overwrite: true });
    }
    yield* fs.makeDirectory(path.join(view, ".claude-plugin"), { recursive: true });
    const manifest = yield* encodeJson({
      name: id,
      ...(pluginScan.version === null ? {} : { version: pluginScan.version }),
      ...(pluginScan.description === null ? {} : { description: pluginScan.description }),
    });
    yield* fs.writeFileString(path.join(view, ".claude-plugin", "plugin.json"), `${manifest}\n`);
  });

  const describe = (
    id: string,
    source: PluginSource,
    pluginScan: PluginScan,
  ): Omit<InstalledPlugin, "enabled" | "installedAt" | "updatedAt"> => ({
    id: PluginId.make(id),
    name: pluginScan.name,
    version: pluginScan.version,
    description: pluginScan.description,
    source: source.type === "git" ? { ...source, url: withoutUrlCredentials(source.url) } : source,
    formats: [...pluginScan.formats],
    skills: pluginScan.skillDirs.map(({ skill }) => skill),
    mcpServers: [...pluginScan.mcpServers],
  });

  /** Fetches a source into `target`: a shallow clone, or a copy of a local folder. */
  const fetchSource = Effect.fn("PluginStore.fetchSource")(function* (
    source: PluginSource,
    target: string,
  ) {
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    if (source.type === "git") {
      if (!isAllowedGitUrl(source.url)) {
        return yield* new PluginError({
          message: "Use an https or ssh git URL, such as https://github.com/owner/plugin.git.",
        });
      }
      yield* git
        .execute({
          operation: "PluginStore.clone",
          cwd: path.dirname(target),
          args: [
            "clone",
            "--depth",
            "1",
            ...(source.ref === undefined ? [] : ["--branch", source.ref]),
            "--",
            source.url,
            target,
          ],
          timeoutMs: 120_000,
        })
        .pipe(Effect.mapError(fail(`Could not clone ${withoutUrlCredentials(source.url)}.`)));
      return;
    }
    const from = path.resolve(source.path);
    const info = yield* fs.stat(from).pipe(Effect.mapError(fail(`${source.path} does not exist.`)));
    if (info.type !== "Directory") {
      return yield* new PluginError({ message: `${source.path} is not a folder.` });
    }
    yield* fs.copy(from, target).pipe(Effect.mapError(fail(`Could not copy ${source.path}.`)));
  });

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const install: PluginStore["Service"]["install"] = (source) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const staging = path.join(pluginsDir, ".staging", yield* random.uuidV4());
        return yield* Effect.gen(function* () {
          yield* fetchSource(source, staging);
          const fallbackName =
            source.type === "git"
              ? (source.url.split(/[/:]/).pop() ?? "plugin").replace(/\.git$/, "")
              : path.basename(path.resolve(source.path));
          const pluginScan = yield* scan(staging, fallbackName);
          if (pluginScan.skillDirs.length === 0 && pluginScan.mcpServers.length === 0) {
            return yield* new PluginError({
              message: "No skills (SKILL.md) or MCP servers (.mcp.json) were found in this plugin.",
            });
          }
          const entries = yield* readRegistry;
          const base = pluginIdFrom(pluginScan.name);
          let id = base;
          for (let suffix = 2; entries.some((entry) => entry.id === id); suffix += 1) {
            id = `${base}-${suffix}`;
          }
          const sourceDir = path.join(pluginsDir, id, "source");
          yield* fs.makeDirectory(path.join(pluginsDir, id), { recursive: true });
          yield* fs.rename(staging, sourceDir);
          const installed = yield* scan(sourceDir, fallbackName);
          yield* buildView(id, installed);
          const at = yield* now;
          const entry: RegistryEntry = {
            id,
            source,
            enabled: false,
            installedAt: at,
            updatedAt: at,
            plugin: describe(id, source, installed),
            env: Object.fromEntries(
              installed.mcpServers.map((server) => [server.name, server.env]),
            ),
          };
          yield* writeRegistry([...entries, entry]);
          return toInstalled(entry);
        }).pipe(
          Effect.mapError((error) =>
            isPluginError(error) ? error : fail("Could not install the plugin.")(error),
          ),
          Effect.ensuring(fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
        );
      }),
    );

  const findEntry = (entries: ReadonlyArray<RegistryEntry>, id: PluginId) => {
    const entry = entries.find((candidate) => candidate.id === id);
    return entry === undefined
      ? Effect.fail(new PluginError({ message: `Plugin ${id} is not installed.` }))
      : Effect.succeed(entry);
  };

  const update: PluginStore["Service"]["update"] = (id) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* readRegistry;
        const entry = yield* findEntry(entries, id);
        const source = entry.source as PluginSource;
        const sourceDir = path.join(pluginsDir, id, "source");
        if (source.type === "git") {
          yield* git
            .execute({
              operation: "PluginStore.pull",
              cwd: sourceDir,
              args: ["pull", "--ff-only"],
              timeoutMs: 120_000,
            })
            .pipe(Effect.mapError(fail(`Could not update ${source.url}.`)));
        } else {
          const staging = path.join(pluginsDir, ".staging", yield* random.uuidV4());
          yield* fetchSource(source, staging).pipe(
            Effect.andThen(fs.remove(sourceDir, { recursive: true })),
            Effect.andThen(fs.rename(staging, sourceDir)),
            Effect.mapError((error) =>
              isPluginError(error) ? error : fail("Could not update the plugin.")(error),
            ),
            Effect.ensuring(fs.remove(staging, { recursive: true }).pipe(Effect.ignore)),
          );
        }
        const previous = entry.plugin as Omit<
          InstalledPlugin,
          "enabled" | "installedAt" | "updatedAt"
        >;
        const pluginScan = yield* scan(sourceDir, previous.name);
        yield* buildView(id, pluginScan).pipe(
          Effect.mapError(fail("Could not refresh the plugin.")),
        );
        const plugin = describe(id, source, pluginScan);
        // A changed MCP server runs a different program: the user sees it again before it runs.
        const sameServers = sameMcpServers(plugin.mcpServers, previous.mcpServers);
        const next: RegistryEntry = {
          ...entry,
          plugin,
          enabled: entry.enabled && sameServers,
          updatedAt: yield* now,
          env: Object.fromEntries(pluginScan.mcpServers.map((server) => [server.name, server.env])),
        };
        yield* writeRegistry(entries.map((candidate) => (candidate.id === id ? next : candidate)));
        return toInstalled(next);
      }),
    );

  const setEnabled: PluginStore["Service"]["setEnabled"] = (id, enabled) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* readRegistry;
        const entry = yield* findEntry(entries, id);
        const next = { ...entry, enabled, updatedAt: yield* now };
        yield* writeRegistry(entries.map((candidate) => (candidate.id === id ? next : candidate)));
        return toInstalled(next);
      }),
    );

  const remove: PluginStore["Service"]["remove"] = (id) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const entries = yield* readRegistry;
        yield* findEntry(entries, id);
        yield* writeRegistry(entries.filter((candidate) => candidate.id !== id));
        yield* fs
          .remove(path.join(pluginsDir, id), { recursive: true })
          .pipe(Effect.mapError(fail(`Could not delete the files of ${id}.`)));
      }),
    );

  const list: PluginStore["Service"]["list"] = readRegistry.pipe(
    Effect.map((entries) => ({ plugins: entries.map(toInstalled), directory: pluginsDir })),
  );

  const bundle: PluginStore["Service"]["bundle"] = readRegistry.pipe(
    Effect.map((entries): ProviderPluginBundle => {
      const enabled = entries.filter((entry) => entry.enabled);
      const plugins = enabled.map((entry) => ({ entry, plugin: toInstalled(entry) }));
      const withSkills = plugins.filter(({ plugin }) => plugin.skills.length > 0);
      return {
        skillRoots: withSkills.map(({ entry }) =>
          path.join(pluginsDir, entry.id, "view", "skills"),
        ),
        claudePluginDirs: withSkills.map(({ entry }) => path.join(pluginsDir, entry.id, "view")),
        mcpServers: plugins.flatMap(({ entry, plugin }) =>
          plugin.mcpServers.map((server) => ({
            name: pluginIdFrom(`${entry.id}-${server.name}`),
            command: server.command,
            args: server.args,
            cwd: server.cwd,
            url: server.url,
            env: entry.env?.[server.name] ?? {},
            envVars: server.envVars,
          })),
        ),
      };
    }),
    Effect.catch((error) =>
      Effect.logWarning("Could not read enabled plugins", { error }).pipe(
        Effect.as(EMPTY_PROVIDER_PLUGIN_BUNDLE),
      ),
    ),
  );

  return PluginStore.of({ list, install, update, setEnabled, remove, bundle });
});

export const layer = Layer.effect(PluginStore, make);

/** Gives provider sessions the enabled plugins. */
export const layerProviderPlugins = Layer.effect(
  ProviderPlugins,
  Effect.gen(function* () {
    const store = yield* PluginStore;
    return ProviderPlugins.of({ read: store.bundle });
  }),
);
