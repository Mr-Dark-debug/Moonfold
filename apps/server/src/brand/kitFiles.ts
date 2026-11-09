/**
 * Pure checks over a brand kit's files: kit-relative paths, SVG safety, font licenses, the
 * project's `.gitignore`, and name slugs. The service does the file I/O around them.
 */

/** The kit's folder, relative to the project root. */
export const BRAND_DIR = ".moonfold/brand";

export const BRAND_FOLDERS = [
  "name",
  "references/shots",
  "directions",
  "tokens",
  "color",
  "type",
  "fonts",
  "logo/png",
  "icons",
  "voice",
  "templates",
  "exports",
  "reviews",
  "guidelines",
] as const;

/**
 * Normalizes a path an agent gave relative to the brand folder. Undefined when it is absolute,
 * empty, or climbs out of the folder; separators become `/`.
 */
export const kitRelativePath = (input: string): string | undefined => {
  const text = input.trim();
  if (text.length === 0 || text.includes("\0")) return undefined;
  if (/^[\\/]/.test(text) || /^[a-z]:/i.test(text) || /^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    return undefined;
  }
  const segments: Array<string> = [];
  for (const segment of text.split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") return undefined;
    segments.push(segment);
  }
  return segments.length === 0 ? undefined : segments.join("/");
};

// Numeric character references would otherwise hide `javascript:` or an event handler.
const decodeCharacterReferences = (text: string) =>
  text.replace(/&#(x[0-9a-f]+|\d+);?/gi, (_match, code: string) => {
    const point =
      code[0] === "x" || code[0] === "X" ? Number.parseInt(code.slice(1), 16) : Number(code);
    return Number.isFinite(point) && point > 0 && point <= 0x10ffff
      ? String.fromCodePoint(point)
      : "";
  });

const isLocalReference = (target: string) => {
  const value = target.trim();
  return value === "" || value.startsWith("#") || /^data:image\//i.test(value);
};

/** Reasons an SVG is unsafe to render or ship; empty when it is plain artwork. */
export const svgProblems = (source: string): ReadonlyArray<string> => {
  const text = decodeCharacterReferences(source);
  const problems: Array<string> = [];
  if (/<script\b/i.test(text)) problems.push("it contains a <script> element");
  if (/<foreignObject\b/i.test(text)) problems.push("it contains a <foreignObject> element");
  if (/[\s"'/]on[a-z]+\s*=/i.test(text))
    problems.push("it has an event handler attribute (on...=)");
  if (/javascript\s*:/i.test(text)) problems.push("it uses a javascript: URL");
  if (/<!ENTITY\b/i.test(text)) problems.push("it declares XML entities");
  if (/@import\b/i.test(text)) problems.push("its style imports another stylesheet");
  for (const match of text.matchAll(/(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isLocalReference(target)) {
      problems.push(`it links outside the file (${target.slice(0, 80)})`);
    }
  }
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const target = match[1] ?? match[2] ?? match[3] ?? "";
    if (!isLocalReference(target)) {
      problems.push(`it loads a resource outside the file (${target.trim().slice(0, 80)})`);
    }
  }
  return [...new Set(problems)];
};

export const isFontLicenseFileName = (name: string) => /^(?:OFL.*\.txt|LICEN[CS]E.*)$/i.test(name);

/** Whether a license file's text names a license fonts may ship under here. */
export const isAllowedFontLicense = (text: string) =>
  /SIL\s+Open\s+Font\s+License|Apache\s+License|\bMIT\b/i.test(text);

interface IgnoreRule {
  readonly negated: boolean;
  readonly pattern: string;
}

const parseIgnoreRules = (text: string): ReadonlyArray<IgnoreRule> =>
  text.split(/\r?\n/).flatMap((raw) => {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) return [];
    const negated = line.startsWith("!");
    const pattern = (negated ? line.slice(1) : line).replace(/^\//, "").replace(/\/+$/, "");
    return pattern === "" ? [] : [{ negated, pattern }];
  });

// Literal paths and one trailing `/*` or `/**` cover the patterns that name the kit's folders.
const ruleMatches = (pattern: string, path: string) => {
  if (pattern === path) return true;
  const wildcard = /^(.*)\/\*(\*)?$/.exec(pattern);
  if (wildcard === null) return false;
  const base = wildcard[1]!;
  if (!path.startsWith(`${base}/`)) return false;
  return wildcard[2] === "*" || !path.slice(base.length + 1).includes("/");
};

/**
 * Whether a project-relative directory is ignored by the root `.gitignore`. As in git, a path
 * inside an ignored directory stays ignored whatever later rules say.
 */
export const isIgnoredByGitignore = (text: string, path: string) => {
  const rules = parseIgnoreRules(text);
  const segments = path.split("/");
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join("/");
    let ignored = false;
    for (const rule of rules) {
      if (ruleMatches(rule.pattern, prefix)) ignored = !rule.negated;
    }
    if (ignored) return true;
  }
  return false;
};

const REFERENCES_DIR = `${BRAND_DIR}/references`;

/** Whether the kit can be committed while its reference screenshots stay out of git. */
export const gitignoreKeepsReferencesPrivate = (text: string) =>
  isIgnoredByGitignore(text, REFERENCES_DIR) && !isIgnoredByGitignore(text, `${BRAND_DIR}/tokens`);

/**
 * Edits a project's `.gitignore` so `references/` is ignored and the rest of the kit can be
 * committed. Git cannot re-include a path inside an ignored directory, so an ignored
 * `.moonfold/` becomes `.moonfold/*`, which still ignores everything else in it.
 */
export const ensureBrandGitignore = (
  text: string,
): { readonly text: string; readonly changed: boolean } => {
  if (gitignoreKeepsReferencesPrivate(text)) return { text, changed: false };
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text === "" ? [] : text.replace(/\r?\n$/, "").split(/\r?\n/);
  const additions: Array<string> = [];
  if (isIgnoredByGitignore(lines.join("\n"), `${BRAND_DIR}/tokens`)) {
    for (let index = 0; index < lines.length; index += 1) {
      const match = /^(\s*)(\/?)\.moonfold\/?(\s*)$/.exec(lines[index]!);
      if (match !== null) lines[index] = `${match[1]}${match[2]}.moonfold/*${match[3]}`;
    }
    additions.push(`!${BRAND_DIR}/`);
  }
  if (!isIgnoredByGitignore([...lines, ...additions].join("\n"), REFERENCES_DIR)) {
    additions.push(`${REFERENCES_DIR}/`);
  }
  const block =
    additions.length === 0
      ? []
      : [
          "",
          "# Moonfold brand kit: commit the kit, keep reference screenshots private.",
          ...additions,
        ];
  const next = [...lines, ...block].join(newline).replace(/^(?:\r?\n)+/, "") + newline;
  return { text: next, changed: next !== text };
};

/** A name as a domain label and package name: lowercase ASCII letters, digits and hyphens. */
export const nameSlug = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");

export const trademarkSearchUrl = (name: string) =>
  `https://branddb.wipo.int/en/similarname?sort=score&strategy=concept&q=${encodeURIComponent(name)}`;

const IMAGE_REFERENCE =
  /(\b(?:src|href|xlink:href)\s*=\s*)(["'])([^"']*?\.(?:png|jpe?g|gif|webp|avif|svg))\2|url\(\s*(["']?)([^"')]*?\.(?:png|jpe?g|gif|webp|avif|svg))\4\s*\)/gi;

/**
 * Rewrites relative image references in a kit page to absolute paths, which the renderer
 * inlines. `resolve` returns undefined for a reference outside the kit, which stays as written.
 */
export const absolutizeKitImages = (
  html: string,
  resolve: (relative: string) => string | undefined,
) =>
  html.replace(
    IMAGE_REFERENCE,
    (
      match,
      attribute: string | undefined,
      quote: string | undefined,
      attributeTarget: string | undefined,
      urlQuote: string | undefined,
      urlTarget: string | undefined,
    ) => {
      const target = attributeTarget ?? urlTarget ?? "";
      if (/^(?:[a-z][a-z0-9+.-]*:|\/|\\|#)/i.test(target.trim())) return match;
      const absolute = resolve(target.trim());
      if (absolute === undefined) return match;
      if (attribute !== undefined) return `${attribute}${quote}${absolute}${quote}`;
      // Keep the author's quoting: a url() inside a style attribute cannot add double quotes.
      const wrap = urlQuote || (/^[^\s"'()]+$/.test(absolute) ? "" : "'");
      return `url(${wrap}${absolute}${wrap})`;
    },
  );
