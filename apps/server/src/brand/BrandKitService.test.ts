import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ThreadId } from "@moonfold/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";

import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as BrandKitService from "./BrandKitService.ts";
import { decodePng, encodePng } from "./png.ts";
import { passingTokens } from "./tokens.testkit.ts";

const target = { threadId: ThreadId.make("thread:brand-test") };

const solidPng = (width: number, height: number) =>
  Buffer.from(
    encodePng({ width, height, data: new Uint8Array(width * height * 4).fill(200) }),
  ).toString("base64");

interface Harness {
  readonly root: string;
  readonly dir: string;
  /** Every page given to the renderer. */
  readonly rendered: Array<{ readonly html: string; readonly width: number | undefined }>;
  readonly requested: Array<string>;
}

const statusFor = (url: string) => (url.includes("taken") ? 200 : 404);

/** Runs `body` against a temporary project that the calling thread works in. */
const withKit = <A, E>(
  body: (
    harness: Harness,
  ) => Effect.Effect<A, E, BrandKitService.BrandKitService | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "moonfold-brand-" });
    const harness: Harness = {
      root,
      dir: path.join(root, ".moonfold", "brand"),
      rendered: [],
      requested: [],
    };
    const services = Layer.mergeAll(
      Layer.mock(ThreadManagementService.ThreadManagementService)({
        getThreadShell: (threadId) =>
          Effect.succeed({ ...liveThreadShell(threadId), worktreePath: root }),
      }),
      Layer.mock(ProjectService.ProjectService)({}),
      Layer.mock(HtmlRender.HtmlRender)({
        preview: (input) =>
          Effect.sync(() => {
            harness.rendered.push({ html: input.html, width: input.width });
            const width = input.width ?? 728;
            return {
              png: solidPng(width, Math.round(width / 2)),
              width,
              contentHeight: Math.round(width / 2),
              capturedHeight: Math.round(width / 2),
              consoleMessages: [],
            };
          }),
      }),
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          harness.requested.push(request.url);
          return request.url.includes("offline")
            ? Effect.fail(
                new HttpClientError.HttpClientError({
                  reason: new HttpClientError.TransportError({ request }),
                }),
              )
            : Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  new Response(null, { status: statusFor(request.url) }),
                ),
              );
        }),
      ),
    );
    return yield* body(harness).pipe(
      Effect.provide(BrandKitService.layer.pipe(Layer.provide(services))),
    );
  }).pipe(Effect.provide(NodeServices.layer));

const writeKitFile = Effect.fn("writeKitFile")(function* (
  dir: string,
  relative: string,
  data: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(dir, ...relative.split("/"));
  yield* fileSystem.makeDirectory(path.dirname(file), { recursive: true });
  yield* fileSystem.writeFileString(file, data);
});

const LOGO =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';

const writePassingKit = Effect.fn("writePassingKit")(function* (dir: string) {
  yield* writeKitFile(dir, "tokens/tokens.json", JSON.stringify(passingTokens()));
  yield* writeKitFile(dir, "logo/logo.svg", LOGO);
  yield* writeKitFile(dir, "logo/inverse.svg", LOGO);
  yield* writeKitFile(dir, "icons/app-icon.svg", LOGO);
  yield* writeKitFile(dir, "fonts/inter/OFL.txt", "SIL Open Font License, Version 1.1");
  yield* writeKitFile(dir, "fonts/inter/Inter.woff2", "font");
});

describe("BrandKitService", () => {
  it.effect("starts a kit once, with its folders and a private references folder", () =>
    withKit(({ root, dir }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fileSystem.writeFileString(path.join(root, ".gitignore"), ".moonfold/\n");
        const brand = yield* BrandKitService.BrandKitService;

        const first = yield* brand.init(target, { prompt: " a calm budgeting app " });
        expect(first.existed).toBe(false);
        expect(first.gitignoreUpdated).toBe(true);
        expect(first.manifest.prompt).toBe("a calm budgeting app");
        expect(Object.values(first.manifest.steps).every((step) => step.status === "pending")).toBe(
          true,
        );
        expect(yield* fileSystem.exists(path.join(dir, "references", "shots"))).toBe(true);
        expect(yield* fileSystem.exists(path.join(dir, "logo", "png"))).toBe(true);
        expect(yield* fileSystem.readFileString(path.join(root, ".gitignore"))).toContain(
          "!.moonfold/brand/\n.moonfold/brand/references/\n",
        );

        const second = yield* brand.init(target, { prompt: "something else" });
        expect(second.existed).toBe(true);
        expect(second.gitignoreUpdated).toBe(false);
        expect(second.manifest.prompt).toBe("a calm budgeting app");
      }),
    ),
  );

  it.effect("records step status and lists files by folder", () =>
    withKit(({ dir }) =>
      Effect.gen(function* () {
        const brand = yield* BrandKitService.BrandKitService;
        const missing = yield* brand.status(target).pipe(Effect.flip);
        expect(missing._tag).toBe("BrandKitNotInitializedError");

        yield* brand.init(target, { prompt: "a kit" });
        yield* brand.setStep(target, { step: "brief", status: "done", note: "Students, calm" });
        const manifest = yield* brand.setStep(target, { step: "brief", status: "in_progress" });
        expect(manifest.steps.brief).toMatchObject({
          status: "in_progress",
          note: "Students, calm",
        });
        yield* writeKitFile(dir, "brief.md", "# Brief\n");

        const status = yield* brand.status(target);
        expect(status.manifest.steps.brief.status).toBe("in_progress");
        expect(
          status.areas.find((area) => area.area === ".")?.files.map((file) => file.path),
        ).toEqual(["README.md", "brand.json", "brief.md"]);
        expect(status.truncated).toBe(false);
      }),
    ),
  );

  it.effect("rejects render paths outside the kit or of the wrong kind", () =>
    withKit(({ rendered }) =>
      Effect.gen(function* () {
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        for (const input of [
          { html: "../../package.json", png: "out.png" },
          { html: "directions/a.html", png: "../../../escape.png" },
          { html: "directions/a.html", png: "directions/a.jpg" },
          { html: "C:\\Windows\\win.ini", png: "out.png" },
        ]) {
          const error = yield* brand.render(target, input).pipe(Effect.flip);
          expect(error._tag).toBe("BrandKitPathError");
        }
        expect(rendered).toEqual([]);
      }),
    ),
  );

  it.effect("renders a kit page with its relative images inlined by absolute path", () =>
    withKit(({ dir, rendered }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        yield* writeKitFile(
          dir,
          "directions/a.html",
          '<img src="../logo/logo.svg"><img src="../../../x.png">',
        );

        const result = yield* brand.render(target, {
          html: "directions/a.html",
          png: "directions/a.png",
          width: 400,
        });
        expect(result).toEqual({ path: "directions/a.png", width: 400, height: 200 });
        const logo = path.join(dir, "logo", "logo.svg").split(path.sep).join("/");
        expect(rendered[0]?.html).toBe(`<img src="${logo}"><img src="../../../x.png">`);
        const png = yield* fileSystem.readFile(path.join(dir, "directions", "a.png"));
        expect(decodePng(png)?.width).toBe(400);
      }),
    ),
  );

  it.effect("validates a passing kit and reports unsafe SVGs, unlicensed fonts and contrast", () =>
    withKit(({ dir }) =>
      Effect.gen(function* () {
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        yield* writePassingKit(dir);

        const passing = yield* brand.validate(target);
        expect(passing.errors).toEqual([]);
        expect(passing.warnings).toEqual([]);
        expect(passing.ok).toBe(true);

        const tokens = passingTokens();
        yield* writeKitFile(
          dir,
          "tokens/tokens.json",
          JSON.stringify({
            ...tokens,
            color: {
              ...tokens.color,
              dark: { ...tokens.color.dark, foreground: { $value: "#1e293b" } },
            },
          }),
        );
        yield* writeKitFile(dir, "logo/mono.svg", '<svg onload="x()"><script/></svg>');
        yield* writeKitFile(dir, "fonts/brush/Brush.woff2", "font");
        yield* writeKitFile(
          dir,
          "fonts/shop/LICENSE.txt",
          "Commercial license. All rights reserved.",
        );

        const failing = yield* brand.validate(target);
        expect(failing.ok).toBe(false);
        expect(failing.errors.map((issue) => issue.path)).toEqual([
          "tokens/tokens.json",
          "tokens/tokens.json",
          "logo/mono.svg",
          "fonts/brush",
          "fonts/shop",
        ]);
        expect(
          failing.contrast.filter((check) => !check.passes).map((check) => check.background),
        ).toEqual(["background", "muted"]);
        const exported = yield* brand.exportKit(target).pipe(Effect.flip);
        expect(exported._tag).toBe("BrandKitInvalidError");
      }),
    ),
  );

  it.effect("warns when the project's .gitignore lets references into git", () =>
    withKit(({ root, dir }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        yield* writePassingKit(dir);
        yield* fileSystem.writeFileString(path.join(root, ".gitignore"), "node_modules/\n");

        const report = yield* brand.validate(target);
        expect(report.ok).toBe(true);
        expect(report.warnings.map((issue) => issue.path)).toEqual(["references"]);
      }),
    ),
  );

  it.effect("exports token files and PNG sizes from a valid kit", () =>
    withKit(({ dir, rendered }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        yield* writePassingKit(dir);

        const result = yield* brand.exportKit(target);
        expect(result.files).toEqual([
          "exports/tokens.css",
          "exports/tailwind.css",
          "exports/tokens.scss",
          "exports/tokens.ts",
          "exports/tokens.json",
          "logo/png/inverse-256.png",
          "logo/png/inverse-512.png",
          "logo/png/inverse-1024.png",
          "logo/png/logo-256.png",
          "logo/png/logo-512.png",
          "logo/png/logo-1024.png",
          "icons/app-icon-512.png",
          "icons/app-icon-16.png",
          "icons/app-icon-32.png",
          "icons/app-icon-180.png",
          "icons/app-icon-192.png",
        ]);
        expect(rendered.map((page) => page.width)).toEqual([256, 512, 1024, 256, 512, 1024, 512]);
        expect(rendered[0]?.html).toContain("background:#0b0f19!important");
        expect(rendered[3]?.html).toContain("background:#ffffff!important");
        const icon = decodePng(
          yield* fileSystem.readFile(path.join(dir, "icons", "app-icon-16.png")),
        );
        expect([icon?.width, icon?.height]).toEqual([16, 8]);
        const css = yield* fileSystem.readFileString(path.join(dir, "exports", "tokens.css"));
        expect(css).toContain("  --color-primary: #1d4ed8;");

        const again = yield* brand.exportKit(target);
        expect(again.files).toEqual(result.files);
        expect(yield* fileSystem.readFileString(path.join(dir, "exports", "tokens.css"))).toBe(css);
      }),
    ),
  );

  it.effect("keeps a reference and copies only PNG screenshots", () =>
    withKit(({ root, dir }) =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const brand = yield* BrandKitService.BrandKitService;
        yield* brand.init(target, { prompt: "a kit" });
        const shot = path.join(root, "shot.png");
        yield* fileSystem.writeFile(shot, Buffer.from(solidPng(4, 4), "base64"));
        const secret = path.join(root, "secret.txt");
        yield* fileSystem.writeFileString(secret, "token");

        const kept = yield* brand.keepReference(target, {
          url: "https://example.com/work",
          title: "Quiet Dashboard!",
          why: "Generous spacing",
          screenshotPath: shot,
        });
        expect(kept).toMatchObject({
          id: "01-quiet-dashboard",
          site: null,
          author: null,
          shot: "references/shots/01-quiet-dashboard.png",
        });
        expect(
          yield* fileSystem.exists(path.join(dir, "references", "shots", "01-quiet-dashboard.png")),
        ).toBe(true);

        const refused = yield* brand
          .keepReference(target, {
            url: "https://example.com",
            title: "x",
            why: "y",
            screenshotPath: secret,
          })
          .pipe(Effect.flip);
        expect(refused).toMatchObject({ _tag: "BrandKitScreenshotError", reason: "not_png" });
        const relative = yield* brand
          .keepReference(target, {
            url: "https://example.com",
            title: "x",
            why: "y",
            screenshotPath: "shot.png",
          })
          .pipe(Effect.flip);
        expect(relative).toMatchObject({ _tag: "BrandKitScreenshotError", reason: "not_absolute" });

        const second = yield* brand.keepReference(target, {
          url: "https://example.org",
          title: "Second",
          why: "Type pairing",
          site: "Example",
        });
        expect(second.id).toBe("02-second");
        const index = JSON.parse(
          yield* fileSystem.readFileString(path.join(dir, "references", "index.json")),
        ) as ReadonlyArray<{ readonly id: string }>;
        expect(index.map((entry) => entry.id)).toEqual(["01-quiet-dashboard", "02-second"]);
      }),
    ),
  );

  it.effect("checks names against the registries without treating failures as answers", () =>
    withKit(({ requested }) =>
      Effect.gen(function* () {
        const brand = yield* BrandKitService.BrandKitService;
        const result = yield* brand.checkNames({ names: ["Lumen", "Taken Co", "Offline", "???"] });
        expect(result.checks).toEqual([
          {
            name: "Lumen",
            slug: "lumen",
            domains: { com: "available", dev: "available", app: "available" },
            github: "available",
            npm: "available",
            trademarkSearchUrl:
              "https://branddb.wipo.int/en/similarname?sort=score&strategy=concept&q=Lumen",
          },
          expect.objectContaining({
            slug: "taken-co",
            domains: { com: "taken", dev: "taken", app: "taken" },
            github: "taken",
            npm: "taken",
          }),
          expect.objectContaining({
            slug: "offline",
            domains: { com: "unknown", dev: "unknown", app: "unknown" },
            github: "unknown",
          }),
          expect.objectContaining({ slug: "", github: "unknown", npm: "unknown" }),
        ]);
        expect(result.note).toContain("not legal clearance");
        expect(requested).toContain("https://rdap.org/domain/lumen.dev");
        expect(requested).toContain("https://api.github.com/users/lumen");
        expect(requested).toContain("https://registry.npmjs.org/lumen");
        expect(requested.filter((url) => url.includes("???"))).toEqual([]);
      }),
    ),
  );
});
