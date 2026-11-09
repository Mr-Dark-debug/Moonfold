/**
 * BrandKitService - the exact parts of a Cassandre brand kit in `<project>/.moonfold/brand/`.
 * Agents write the kit's creative source; this service checks it and generates everything
 * derived from it. Kit files are data: nothing read from them is ever followed.
 */
import {
  BRAND_STEPS,
  type BrandExportResult,
  type BrandFileEntry,
  type BrandInitResult,
  type BrandIssue,
  BrandManifest,
  type BrandNameCheck,
  type BrandNameCheckInput,
  type BrandNameCheckResult,
  type BrandAvailability,
  type BrandReference,
  BrandReferenceIndex,
  type BrandReferenceInput,
  type BrandRenderInput,
  type BrandRenderResult,
  type BrandStatus,
  type BrandStepInput,
  type BrandValidationReport,
  type ProjectId,
  type ThreadId,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient } from "effect/http";

import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import {
  absolutizeKitImages,
  BRAND_DIR,
  BRAND_FOLDERS,
  ensureBrandGitignore,
  gitignoreKeepsReferencesPrivate,
  isAllowedFontLicense,
  isFontLicenseFileName,
  kitRelativePath,
  nameSlug,
  svgProblems,
  trademarkSearchUrl,
} from "./kitFiles.ts";
import { decodePng, downscale, encodePng, isPng } from "./png.ts";
import { exportFiles, readTokens, type ResolvedTokens, TOKENS_PATH } from "./tokens.ts";

export class BrandKitTargetError extends Schema.TaggedError<BrandKitTargetError>()(
  "BrandKitTargetError",
  {
    target: Schema.Literals(["thread", "project"]),
    id: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `The ${this.target} ${this.id} or its project folder was not found.`;
  }
}

export class BrandKitPathError extends Schema.TaggedError<BrandKitPathError>()(
  "BrandKitPathError",
  {
    path: Schema.String,
    expected: Schema.optional(Schema.String),
  },
) {
  override get message(): string {
    return this.expected === undefined
      ? `${this.path} must be a path inside the brand folder, such as directions/a.html.`
      : `${this.path} must be a path inside the brand folder ending in ${this.expected}.`;
  }
}

export class BrandKitNotInitializedError extends Schema.TaggedError<BrandKitNotInitializedError>()(
  "BrandKitNotInitializedError",
  {},
) {
  override get message(): string {
    return "This project has no brand kit yet. Call brand_init first.";
  }
}

export class BrandKitManifestError extends Schema.TaggedError<BrandKitManifestError>()(
  "BrandKitManifestError",
  { path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `${this.path} is not in the format Moonfold writes. Restore it or call brand_init in a fresh folder.`;
  }
}

export class BrandKitFileError extends Schema.TaggedError<BrandKitFileError>()(
  "BrandKitFileError",
  {
    operation: Schema.Literals(["read", "write", "list"]),
    path: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Could not ${this.operation} ${this.path} in the brand kit.`;
  }
}

export class BrandKitInvalidError extends Schema.TaggedError<BrandKitInvalidError>()(
  "BrandKitInvalidError",
  { errorCount: Schema.Number },
) {
  override get message(): string {
    return `The kit has ${this.errorCount} validation error${this.errorCount === 1 ? "" : "s"}. Call brand_validate, fix them, then export again.`;
  }
}

export class BrandKitScreenshotError extends Schema.TaggedError<BrandKitScreenshotError>()(
  "BrandKitScreenshotError",
  {
    screenshotPath: Schema.String,
    reason: Schema.Literals(["not_absolute", "missing", "too_large", "not_png"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    switch (this.reason) {
      case "not_absolute":
        return "screenshotPath must be an absolute path, such as the one preview_snapshot returns with save=true.";
      case "missing":
        return `${this.screenshotPath} could not be read.`;
      case "too_large":
        return `${this.screenshotPath} is larger than ${MAX_SCREENSHOT_BYTES / MIB} MiB.`;
      case "not_png":
        return `${this.screenshotPath} is not a PNG image.`;
    }
  }
}

export class BrandKitImageError extends Schema.TaggedError<BrandKitImageError>()(
  "BrandKitImageError",
  { path: Schema.String },
) {
  override get message(): string {
    return `${this.path} could not be rendered to an image. Check that it is a plain SVG the browser can draw.`;
  }
}

type RenderError = Effect.Error<ReturnType<HtmlRender.HtmlRender["Service"]["preview"]>>;

export type BrandKitError =
  | BrandKitTargetError
  | BrandKitPathError
  | BrandKitNotInitializedError
  | BrandKitManifestError
  | BrandKitFileError;

/** Whose kit: the calling thread's checkout, or a project's own folder. */
export type BrandKitTarget = { readonly threadId: ThreadId } | { readonly projectId: ProjectId };

export class BrandKitService extends Context.Service<
  BrandKitService,
  {
    readonly init: (
      target: BrandKitTarget,
      input: { readonly prompt: string },
    ) => Effect.Effect<BrandInitResult, BrandKitError>;
    readonly status: (target: BrandKitTarget) => Effect.Effect<BrandStatus, BrandKitError>;
    readonly setStep: (
      target: BrandKitTarget,
      input: BrandStepInput,
    ) => Effect.Effect<BrandManifest, BrandKitError>;
    readonly checkNames: (input: BrandNameCheckInput) => Effect.Effect<BrandNameCheckResult>;
    readonly keepReference: (
      target: BrandKitTarget,
      input: BrandReferenceInput,
    ) => Effect.Effect<BrandReference, BrandKitError | BrandKitScreenshotError>;
    readonly render: (
      target: BrandKitTarget,
      input: BrandRenderInput,
    ) => Effect.Effect<BrandRenderResult, BrandKitError | RenderError>;
    readonly validate: (
      target: BrandKitTarget,
    ) => Effect.Effect<BrandValidationReport, BrandKitError>;
    readonly exportKit: (
      target: BrandKitTarget,
    ) => Effect.Effect<
      BrandExportResult,
      BrandKitError | BrandKitInvalidError | BrandKitImageError | RenderError
    >;
  }
>()("moonfold/brand/BrandKitService") {}

const MIB = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 20 * MIB;
const MAX_PAGE_BYTES = 5 * MIB;
const MAX_LISTED_FILES = 500;
const LOOKUP_TIMEOUT = "8 seconds";
const LOOKUP_CONCURRENCY = 4;
const LOGO_WIDTHS = [256, 512, 1_024] as const;
const APP_ICON_RENDER_WIDTH = 512;
const APP_ICON_SMALL_WIDTHS = [16, 32, 180, 192] as const;

const NAME_CHECK_NOTE =
  "Availability comes from public registries at the time of the lookup. It is not legal clearance; search trademarks with trademarkSearchUrl and ask a lawyer before relying on a name.";

const README = `# Brand kit

Built with Cassandre in Moonfold. \`brand.json\` records the prompt and the status of each step.

- \`brief.md\`, \`plan.md\`: what was asked for and the agreed plan.
- \`name/\`: name candidates, availability checks and the decision.
- \`references/\`: kept references and their analysis. Screenshots belong to their authors; this folder stays out of git.
- \`directions/\`: the directions explored and the board comparing them.
- \`tokens/tokens.json\`: the source of truth for color, type, spacing and radius.
- \`color/\`, \`type/\`, \`voice/\`: palette, type and voice guides.
- \`fonts/\`: open-license font files, each family with its license.
- \`logo/\`, \`icons/\`, \`templates/\`: SVG artwork and rendered PNG sizes.
- \`exports/\`: generated from the tokens. Do not edit by hand.
- \`reviews/\`: review rounds and scores.
- \`guidelines/index.html\`: the brand book.
`;

const decodeManifestJson = Schema.decodeUnknownEffect(Schema.fromJsonString(BrandManifest));
const decodeReferenceIndexJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(BrandReferenceIndex),
);
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

const toJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

interface KitListing {
  readonly files: ReadonlyArray<BrandFileEntry>;
  readonly directories: ReadonlyArray<string>;
}

const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const httpClient = HttpClient.withScope(yield* HttpClient.HttpClient);
  const htmlRender = yield* HtmlRender.HtmlRender;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  // Manifest and reference index updates are read-modify-write.
  const writes = yield* Semaphore.make(1);

  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const projectRoot = Effect.fn("BrandKitService.projectRoot")(function* (target: BrandKitTarget) {
    if ("threadId" in target) {
      const notFound = (cause?: unknown) =>
        new BrandKitTargetError({ target: "thread", id: target.threadId, cause });
      const shell = yield* threads.getThreadShell(target.threadId).pipe(Effect.mapError(notFound));
      if (shell === null || shell.deletedAt !== null) return yield* notFound();
      // A thread in a worktree builds its kit there, as its turns work there.
      if (shell.worktreePath !== null) return path.resolve(shell.worktreePath);
      return yield* projectFolder(shell.projectId);
    }
    return yield* projectFolder(target.projectId);
  });

  const projectFolder = (projectId: ProjectId) =>
    projects.getById(projectId).pipe(
      Effect.mapError(
        (cause) => new BrandKitTargetError({ target: "project", id: projectId, cause }),
      ),
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.fail(new BrandKitTargetError({ target: "project", id: projectId })),
          onSome: (project) => Effect.succeed(path.resolve(project.workspaceRoot)),
        }),
      ),
    );

  const locate = Effect.fn("BrandKitService.locate")(function* (target: BrandKitTarget) {
    const root = yield* projectRoot(target);
    return { root, dir: path.join(root, ...BRAND_DIR.split("/")) };
  });

  const inKit = (dir: string, relative: string, extensions?: ReadonlyArray<string>) => {
    const normalized = kitRelativePath(relative);
    const expected = extensions?.join(" or ");
    if (
      normalized === undefined ||
      (extensions !== undefined &&
        !extensions.some((extension) => normalized.toLowerCase().endsWith(extension)))
    ) {
      return Effect.fail(
        new BrandKitPathError({ path: relative, ...(expected === undefined ? {} : { expected }) }),
      );
    }
    return Effect.succeed({
      relative: normalized,
      absolute: path.join(dir, ...normalized.split("/")),
    });
  };

  const readText = (absolute: string, relative: string) =>
    fileSystem
      .readFileString(absolute)
      .pipe(
        Effect.mapError(
          (cause) => new BrandKitFileError({ operation: "read", path: relative, cause }),
        ),
      );

  const writeBytes = Effect.fn("BrandKitService.writeBytes")(function* (
    absolute: string,
    relative: string,
    data: Uint8Array | string,
  ) {
    const failed = (cause: unknown) =>
      new BrandKitFileError({ operation: "write", path: relative, cause });
    yield* fileSystem
      .makeDirectory(path.dirname(absolute), { recursive: true })
      .pipe(Effect.mapError(failed));
    // Write beside the target, then rename, so a reader never sees half a file.
    const temporary = `${absolute}.tmp`;
    yield* (
      typeof data === "string"
        ? fileSystem.writeFileString(temporary, data)
        : fileSystem.writeFile(temporary, data)
    ).pipe(Effect.andThen(fileSystem.rename(temporary, absolute)), Effect.mapError(failed));
  });

  const exists = (absolute: string, relative: string) =>
    fileSystem
      .exists(absolute)
      .pipe(
        Effect.mapError(
          (cause) => new BrandKitFileError({ operation: "read", path: relative, cause }),
        ),
      );

  const readManifest = Effect.fn("BrandKitService.readManifest")(function* (dir: string) {
    const file = path.join(dir, "brand.json");
    if (!(yield* exists(file, "brand.json"))) return yield* new BrandKitNotInitializedError();
    const text = yield* readText(file, "brand.json");
    return yield* decodeManifestJson(text).pipe(
      Effect.mapError((cause) => new BrandKitManifestError({ path: "brand.json", cause })),
    );
  });

  const listKit = Effect.fn("BrandKitService.listKit")(function* (dir: string) {
    const failed = (cause: unknown) =>
      new BrandKitFileError({ operation: "list", path: ".", cause });
    const names = yield* fileSystem
      .readDirectory(dir, { recursive: true })
      .pipe(Effect.mapError(failed));
    const entries = yield* Effect.forEach(
      names,
      (name) =>
        fileSystem.stat(path.join(dir, name)).pipe(
          Effect.map((info) => ({
            path: name.split(path.sep).join("/"),
            type: info.type,
            sizeBytes: Number(info.size),
          })),
          // A file removed while listing is simply not listed.
          Effect.orElseSucceed(() => undefined),
        ),
      { concurrency: 8 },
    );
    const present = entries.filter((entry) => entry !== undefined);
    return {
      files: present
        .filter((entry) => entry.type === "File" && !entry.path.endsWith(".tmp"))
        .map(({ path: file, sizeBytes }) => ({ path: file, sizeBytes }))
        .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
      directories: present
        .filter((entry) => entry.type === "Directory")
        .map((entry) => entry.path)
        .toSorted(),
    } satisfies KitListing;
  });

  const init: BrandKitService["Service"]["init"] = Effect.fn("BrandKitService.init")(
    function* (target, input) {
      const { root, dir } = yield* locate(target);
      return yield* writes.withPermits(1)(
        Effect.gen(function* () {
          for (const folder of BRAND_FOLDERS) {
            yield* fileSystem
              .makeDirectory(path.join(dir, ...folder.split("/")), { recursive: true })
              .pipe(
                Effect.mapError(
                  (cause) => new BrandKitFileError({ operation: "write", path: folder, cause }),
                ),
              );
          }
          const manifestFile = path.join(dir, "brand.json");
          const existed = yield* exists(manifestFile, "brand.json");
          let manifest: BrandManifest;
          if (existed) {
            manifest = yield* readManifest(dir);
          } else {
            const createdAt = yield* now;
            const pending = { status: "pending" as const, updatedAt: createdAt };
            manifest = {
              version: 1,
              prompt: input.prompt.trim(),
              createdAt,
              updatedAt: createdAt,
              steps: Object.fromEntries(
                BRAND_STEPS.map((step) => [step, pending]),
              ) as BrandManifest["steps"],
            };
            yield* writeBytes(manifestFile, "brand.json", toJson(manifest));
          }
          const readme = path.join(dir, "README.md");
          if (!(yield* exists(readme, "README.md"))) yield* writeBytes(readme, "README.md", README);

          const gitignore = path.join(root, ".gitignore");
          const current = (yield* exists(gitignore, "../../.gitignore"))
            ? yield* readText(gitignore, "../../.gitignore")
            : "";
          const edited = ensureBrandGitignore(current);
          if (edited.changed) yield* writeBytes(gitignore, "../../.gitignore", edited.text);
          return { manifest, existed, gitignoreUpdated: edited.changed };
        }),
      );
    },
  );

  const status: BrandKitService["Service"]["status"] = Effect.fn("BrandKitService.status")(
    function* (target) {
      const { dir } = yield* locate(target);
      const manifest = yield* readManifest(dir);
      const { files } = yield* listKit(dir);
      const areas = new Map<string, Array<BrandFileEntry>>();
      for (const file of files.slice(0, MAX_LISTED_FILES)) {
        const slash = file.path.indexOf("/");
        const area = slash === -1 ? "." : file.path.slice(0, slash);
        areas.set(area, [...(areas.get(area) ?? []), file]);
      }
      return {
        manifest,
        areas: [...areas.keys()].toSorted().map((area) => ({ area, files: areas.get(area) ?? [] })),
        truncated: files.length > MAX_LISTED_FILES,
      };
    },
  );

  const setStep: BrandKitService["Service"]["setStep"] = Effect.fn("BrandKitService.setStep")(
    function* (target, input) {
      const { dir } = yield* locate(target);
      return yield* writes.withPermits(1)(
        Effect.gen(function* () {
          const manifest = yield* readManifest(dir);
          const updatedAt = yield* now;
          // An omitted note keeps the one already there.
          const note = input.note ?? manifest.steps[input.step].note;
          const next: BrandManifest = {
            ...manifest,
            updatedAt,
            steps: {
              ...manifest.steps,
              [input.step]: {
                status: input.status,
                ...(note === undefined ? {} : { note }),
                updatedAt,
              },
            },
          };
          yield* writeBytes(path.join(dir, "brand.json"), "brand.json", toJson(next));
          return next;
        }),
      );
    },
  );

  // 404 is the registry saying the name is free, 200 that it exists; anything else says nothing.
  const lookup = (url: string, accept: string) =>
    httpClient
      .get(url, { headers: { accept, "user-agent": "Moonfold brand kit name check" } })
      .pipe(
        Effect.map(({ status }): BrandAvailability =>
          status === 404 ? "available" : status === 200 ? "taken" : "unknown",
        ),
        Effect.scoped,
        Effect.timeoutOption(LOOKUP_TIMEOUT),
        Effect.map(Option.getOrElse((): BrandAvailability => "unknown")),
        Effect.orElseSucceed((): BrandAvailability => "unknown"),
      );

  const checkNames: BrandKitService["Service"]["checkNames"] = Effect.fn(
    "BrandKitService.checkNames",
  )(function* (input) {
    const checks = yield* Effect.forEach(
      input.names,
      (name) =>
        Effect.gen(function* () {
          const slug = nameSlug(name);
          const look = (url: string, accept: string) =>
            slug === "" ? Effect.succeed<BrandAvailability>("unknown") : lookup(url, accept);
          const rdap = (tld: string) =>
            look(`https://rdap.org/domain/${slug}.${tld}`, "application/rdap+json");
          const [com, dev, app, github, npm] = yield* Effect.all(
            [
              rdap("com"),
              rdap("dev"),
              rdap("app"),
              look(`https://api.github.com/users/${slug}`, "application/vnd.github+json"),
              look(`https://registry.npmjs.org/${slug}`, "application/json"),
            ],
            { concurrency: LOOKUP_CONCURRENCY },
          );
          return {
            name,
            slug,
            domains: { com, dev, app },
            github,
            npm,
            trademarkSearchUrl: trademarkSearchUrl(name),
          } satisfies BrandNameCheck;
        }),
      // Names run one or two at a time so no more than about eight requests are in flight.
      { concurrency: 2 },
    );
    return { checks, note: NAME_CHECK_NOTE };
  });

  const keepReference: BrandKitService["Service"]["keepReference"] = Effect.fn(
    "BrandKitService.keepReference",
  )(function* (target, input) {
    const { dir } = yield* locate(target);
    yield* readManifest(dir);
    const shot =
      input.screenshotPath === undefined ? undefined : yield* readScreenshot(input.screenshotPath);
    return yield* writes.withPermits(1)(
      Effect.gen(function* () {
        const indexRelative = "references/index.json";
        const indexFile = path.join(dir, "references", "index.json");
        const index = (yield* exists(indexFile, indexRelative))
          ? yield* readText(indexFile, indexRelative).pipe(
              Effect.flatMap((text) =>
                decodeReferenceIndexJson(text).pipe(
                  Effect.mapError(
                    (cause) => new BrandKitManifestError({ path: indexRelative, cause }),
                  ),
                ),
              ),
            )
          : [];
        const next =
          index.reduce((highest, entry) => {
            const number = Number.parseInt(entry.id, 10);
            return Number.isFinite(number) ? Math.max(highest, number) : highest;
          }, 0) + 1;
        const id = [String(next).padStart(2, "0"), nameSlug(input.title).slice(0, 40)]
          .filter((part) => part !== "")
          .join("-")
          .replace(/-+$/, "");
        const shotRelative = shot === undefined ? undefined : `references/shots/${id}.png`;
        if (shot !== undefined && shotRelative !== undefined) {
          yield* writeBytes(path.join(dir, "references", "shots", `${id}.png`), shotRelative, shot);
        }
        const entry: BrandReference = {
          id,
          url: input.url,
          title: input.title,
          why: input.why,
          site: input.site ?? null,
          author: input.author ?? null,
          keptAt: yield* now,
          ...(shotRelative === undefined ? {} : { shot: shotRelative }),
        };
        yield* writeBytes(indexFile, indexRelative, toJson([...index, entry]));
        return entry;
      }),
    );
  });

  const readScreenshot = Effect.fn("BrandKitService.readScreenshot")(function* (
    screenshotPath: string,
  ) {
    const fail = (reason: BrandKitScreenshotError["reason"], cause?: unknown) =>
      new BrandKitScreenshotError({ screenshotPath, reason, cause });
    if (!path.isAbsolute(screenshotPath)) return yield* fail("not_absolute");
    const info = yield* fileSystem
      .stat(screenshotPath)
      .pipe(Effect.mapError((cause) => fail("missing", cause)));
    if (info.type !== "File") return yield* fail("missing");
    if (Number(info.size) > MAX_SCREENSHOT_BYTES) return yield* fail("too_large");
    const bytes = yield* fileSystem
      .readFile(screenshotPath)
      .pipe(Effect.mapError((cause) => fail("missing", cause)));
    // Only image bytes are copied, so a path to any other file reveals nothing.
    if (!isPng(bytes)) return yield* fail("not_png");
    return bytes;
  });

  const render: BrandKitService["Service"]["render"] = Effect.fn("BrandKitService.render")(
    function* (target, input) {
      const { dir } = yield* locate(target);
      const page = yield* inKit(dir, input.html, [".html", ".htm"]);
      const output = yield* inKit(dir, input.png, [".png"]);
      const info = yield* fileSystem
        .stat(page.absolute)
        .pipe(
          Effect.mapError(
            (cause) => new BrandKitFileError({ operation: "read", path: page.relative, cause }),
          ),
        );
      if (Number(info.size) > MAX_PAGE_BYTES) {
        return yield* new BrandKitPathError({
          path: page.relative,
          expected: "a page under 5 MiB",
        });
      }
      const html = absolutizeKitImages(yield* readText(page.absolute, page.relative), (relative) =>
        kitImagePath(dir, path.dirname(page.absolute), relative),
      );
      const preview = yield* htmlRender.preview({
        html,
        width: input.width,
        appearance: input.appearance,
      });
      yield* writeBytes(output.absolute, output.relative, Buffer.from(preview.png, "base64"));
      return {
        path: output.relative,
        width: preview.width,
        height: preview.capturedHeight,
        ...(preview.missingImages === undefined ? {} : { missingImages: preview.missingImages }),
      };
    },
  );

  // The renderer inlines images named by absolute path; `/` works for it on every platform.
  const kitImagePath = (dir: string, from: string, relative: string) => {
    const absolute = path.resolve(from, relative.split("?")[0]!.split("#")[0]!);
    const inside = path.relative(dir, absolute);
    if (inside === "" || inside.startsWith("..") || path.isAbsolute(inside)) return undefined;
    return absolute.split(path.sep).join("/");
  };

  const inspect = Effect.fn("BrandKitService.inspect")(function* (root: string, dir: string) {
    yield* readManifest(dir);
    const errors: Array<BrandIssue> = [];
    const warnings: Array<BrandIssue> = [];
    const listing = yield* listKit(dir);
    const fileNames = new Set(listing.files.map((file) => file.path));

    let tokens: ResolvedTokens | undefined;
    let contrast: BrandValidationReport["contrast"] = [];
    if (!fileNames.has(TOKENS_PATH)) {
      errors.push({ path: TOKENS_PATH, message: "The tokens file is missing." });
    } else {
      const text = yield* readText(path.join(dir, "tokens", "tokens.json"), TOKENS_PATH);
      const document = decodeJson(text);
      if (Option.isNone(document)) {
        errors.push({ path: TOKENS_PATH, message: "The file is not valid JSON." });
      } else {
        const report = readTokens(document.value);
        errors.push(...report.errors);
        warnings.push(...report.warnings);
        contrast = report.contrast;
        tokens = report.tokens;
      }
    }

    for (const file of listing.files.filter((entry) => entry.path.toLowerCase().endsWith(".svg"))) {
      const problems = svgProblems(
        yield* readText(path.join(dir, ...file.path.split("/")), file.path),
      );
      if (problems.length > 0) {
        errors.push({ path: file.path, message: `Unsafe SVG: ${problems.join("; ")}.` });
      }
    }

    const fontFamilies = listing.directories.filter(
      (directory) => directory.startsWith("fonts/") && directory.split("/").length === 2,
    );
    for (const family of fontFamilies) {
      const licenses = listing.files.filter(
        (file) =>
          file.path.startsWith(`${family}/`) &&
          isFontLicenseFileName(file.path.slice(family.length + 1)),
      );
      if (licenses.length === 0) {
        errors.push({
          path: family,
          message: "No license file (OFL.txt or LICENSE) beside the fonts.",
        });
        continue;
      }
      let allowed = false;
      for (const license of licenses) {
        const text = yield* readText(path.join(dir, ...license.path.split("/")), license.path);
        if (isAllowedFontLicense(text)) allowed = true;
      }
      if (!allowed) {
        errors.push({
          path: family,
          message:
            "The license file does not name the SIL Open Font License, Apache License or MIT.",
        });
      }
    }
    for (const file of listing.files.filter((entry) => /^fonts\/[^/]+$/.test(entry.path))) {
      warnings.push({
        path: file.path,
        message: "Put font files in fonts/<family>/ with their license.",
      });
    }

    const gitignore = path.join(root, ".gitignore");
    const ignoreText = (yield* exists(gitignore, "../../.gitignore"))
      ? yield* readText(gitignore, "../../.gitignore")
      : "";
    if (!gitignoreKeepsReferencesPrivate(ignoreText)) {
      warnings.push({
        path: "references",
        message:
          "The project's .gitignore does not keep references/ out of git. Call brand_init to fix it.",
      });
    }

    return {
      report: {
        ok: errors.length === 0,
        errors,
        warnings,
        contrast,
      } satisfies BrandValidationReport,
      tokens,
      listing,
    };
  });

  const validate: BrandKitService["Service"]["validate"] = Effect.fn("BrandKitService.validate")(
    function* (target) {
      const { root, dir } = yield* locate(target);
      return (yield* inspect(root, dir)).report;
    },
  );

  const renderSvg = Effect.fn("BrandKitService.renderSvg")(function* (
    dir: string,
    relative: string,
    width: number,
    background: string,
  ) {
    const source = path
      .join(dir, ...relative.split("/"))
      .split(path.sep)
      .join("/");
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0!important;padding:0!important;background:${background}!important}img{display:block;width:${width}px;height:auto}</style></head><body><img src="${source}" alt=""></body></html>`;
    const preview = yield* htmlRender.preview({ html, width, appearance: "light" });
    if (preview.missingImages !== undefined && preview.missingImages.length > 0) {
      return yield* new BrandKitImageError({ path: relative });
    }
    return new Uint8Array(Buffer.from(preview.png, "base64"));
  });

  const exportKit: BrandKitService["Service"]["exportKit"] = Effect.fn("BrandKitService.exportKit")(
    function* (target) {
      const { root, dir } = yield* locate(target);
      const { report, tokens, listing } = yield* inspect(root, dir);
      if (!report.ok || tokens === undefined) {
        return yield* new BrandKitInvalidError({ errorCount: Math.max(1, report.errors.length) });
      }
      const written: Array<string> = [];
      const write = Effect.fnUntraced(function* (relative: string, data: Uint8Array | string) {
        yield* writeBytes(path.join(dir, ...relative.split("/")), relative, data);
        written.push(relative);
      });
      for (const [relative, contents] of exportFiles(tokens)) yield* write(relative, contents);

      // Each logo sits on the background it is drawn for: inverse on dark, the rest on light.
      const logos = listing.files
        .map((file) => file.path)
        .filter((file) => /^logo\/[^/]+\.svg$/i.test(file));
      for (const logo of logos) {
        const name = logo.slice("logo/".length).replace(/\.svg$/i, "");
        const background = /inverse/i.test(name)
          ? tokens.color.dark.background!
          : tokens.color.light.background!;
        for (const width of LOGO_WIDTHS) {
          yield* write(
            `logo/png/${name}-${width}.png`,
            yield* renderSvg(dir, logo, width, background),
          );
        }
      }

      const icon = "icons/app-icon.svg";
      if (listing.files.some((file) => file.path === icon)) {
        const large = yield* renderSvg(
          dir,
          icon,
          APP_ICON_RENDER_WIDTH,
          tokens.color.light.background!,
        );
        yield* write(`icons/app-icon-${APP_ICON_RENDER_WIDTH}.png`, large);
        // The browser captures at least 240 pixels wide, so smaller sizes are resampled.
        const image = decodePng(large);
        if (image === undefined) return yield* new BrandKitImageError({ path: icon });
        for (const width of APP_ICON_SMALL_WIDTHS) {
          yield* write(`icons/app-icon-${width}.png`, encodePng(downscale(image, width)));
        }
      }
      return { files: written };
    },
  );

  return BrandKitService.of({
    init,
    status,
    setStep,
    checkNames,
    keepReference,
    render,
    validate,
    exportKit,
  });
});

export const layer = Layer.effect(BrandKitService, make);
