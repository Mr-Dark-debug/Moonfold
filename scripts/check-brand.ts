// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A synchronous repo scan run from the shell and CI.
// Fails when a T3 Code brand token appears outside the files that legitimately name the
// upstream project (license, attribution, fork history). Matching is word-aware, so values
// such as `uint32` or `int32` are not hits.
//
//   node scripts/check-brand.ts
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");

// Files whose job is to name the upstream project or describe the fork.
const ALLOWED_FILES: ReadonlyArray<RegExp> = [
  /^\.repos\//,
  /^docs\/protocol\//,
  /^docs\/plans\//,
  /^LICENSE$/,
  /^NOTICE$/,
  /^THIRD_PARTY_LICENSES/,
  /^third-party-licenses\.config\.json$/,
  /^pnpm-lock\.yaml$/,
  /^CLAUDE\.md$/,
  /^BUILD-PLAN\.md$/,
  /^LAUNCH-PLAN\.md$/,
  /^PROGRESS\.md$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^docs\/releases\//,
  /^docs\/(ARCHITECTURE|BRAND|CODEX-APP-REA|DECISIONS|FEATURE-MATRIX|NETWORK-AUDIT|PROTOCOL|REA|REA-SELF-AUDIT|REA-(?:PHASE|BETA)[0-9]+|QA-REPORT|QA-PHASE[0-9]+|UX-STUDY|UX-STUDY-TEMPLATE)\.md$/,
  /^docs\/DEV\.md$/,
  /^docs\/operations\/release\.md$/,
  /^scripts\/brand-codemod\.ts$/,
  /^scripts\/check-brand\.ts$/,
  /^apps\/web\/src\/components\/settings\/AboutMoonfold\.tsx$/,
  // The website's credits and FAQ name the upstream project, like the README.
  /^moonfold-website\/(?:src|dist)\/index\.html$/,
  // Its generated docs and blog pages carry the same credit in their footer, and the blog
  // describes the fork's history.
  /^moonfold-website\/(?:content\/blog\/|public\/(?:docs|blog)\/|scripts\/build-content\.mjs$)/,
  // Upstream's hosted relay and its account pages (D-64). They only run with a hosted sign-in key,
  // which Moonfold does not ship, and name the upstream services they were written for.
  /^infra\/relay\//,
  /^apps\/web\/src\/components\/clerk\//,
  /^apps\/web\/src\/components\/cloud\/TunnelUsage\.tsx$/,
  /^docs\/operations\/relay-observability\.md$/,
];

// Allowed inside any file: references to upstream history.
const ALLOWED_MATCHES: ReadonlyArray<RegExp> = [
  // Attribution link to the upstream project.
  /\[T3 Code\]\(https:\/\/github\.com\/pingdotgg\/t3code\)/g,
  /github\.com\/pingdotgg\/t3code\/(?:issues|pull|commit|blob|tree|discussions)\/\S+/g,
];

const BRAND_TOKENS: ReadonlyArray<RegExp> = [
  /t3\.codes/gi,
  /t3\.chat/gi,
  /t3tools/gi,
  /pingdotgg/gi,
  /t3[-_]?code/gi,
  /T3 Tools/g,
  /(?<![A-Za-z0-9])[Tt]3(?![0-9])/g,
  /(?<=[a-z])T3(?=[A-Z_]|(?![A-Za-z0-9]))/g,
];

const BINARY_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|ico|icns|bmp|ttf|otf|woff2?|zip|tgz|gz|wasm|node|exe|dll|sqlite|db|mp[34]|mov|wav|pdf)$/i;
// Long opaque runs (hashes, base64 in recorded fixtures) can contain any two characters.
const OPAQUE =
  /(?=[A-Za-z0-9+=]*[0-9])(?=[A-Za-z0-9+=]*[A-Z])(?=[A-Za-z0-9+=]*[a-z])[A-Za-z0-9+=]{60,}/g;

export interface BrandHit {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

export function findBrandHits(file: string, content: string): Array<BrandHit> {
  const hits: Array<BrandHit> = [];
  const lines = content.split("\n");
  lines.forEach((raw, index) => {
    let line = raw.replace(OPAQUE, "");
    for (const allowed of ALLOWED_MATCHES) line = line.replace(allowed, "");
    if (BRAND_TOKENS.some((token) => new RegExp(token.source, token.flags).test(line))) {
      hits.push({ file, line: index + 1, text: raw.trim().slice(0, 160) });
    }
  });
  return hits;
}

function main(): void {
  const files = NodeChildProcess.execFileSync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  })
    .split("\0")
    .filter((file) => file.length > 0)
    .filter((file) => !ALLOWED_FILES.some((pattern) => pattern.test(file)))
    .filter((file) => !BINARY_EXTENSIONS.test(file));

  const hits: Array<BrandHit> = [];
  for (const file of files) {
    const absolute = NodePath.join(repoRoot, file);
    // Submodule gitlinks are listed too; CI checks them out as directories.
    if (!NodeFS.statSync(absolute, { throwIfNoEntry: false })?.isFile()) continue;
    const bytes = NodeFS.readFileSync(absolute);
    if (bytes.includes(0)) continue;
    hits.push(...findBrandHits(file, bytes.toString("utf8")));
    // File names count too.
    hits.push(...findBrandHits(file, file).map((hit) => ({ ...hit, line: 0 })));
  }

  if (hits.length === 0) {
    console.log("check-brand: no T3 brand tokens outside attribution files");
    return;
  }
  for (const hit of hits) console.log(`${hit.file}:${hit.line}: ${hit.text}`);
  console.log(`check-brand: ${hits.length} hit(s)`);
  process.exitCode = 1;
}

if (import.meta.main) main();
