/**
 * Reads a kit's `tokens/tokens.json` (the W3C Design Tokens shape Cassandre uses), checks it,
 * and generates the exports from it. Generation is deterministic: keys are sorted, so the same
 * tokens always give byte-identical files.
 */
import type { BrandContrastCheck, BrandIssue } from "@moonfold/contracts";

import { contrastRatio, parseColor, type ParsedColor, toHex } from "./color.ts";

export const TOKENS_PATH = "tokens/tokens.json";

const COLOR_ROLES = [
  "background",
  "foreground",
  "primary",
  "primary-foreground",
  "accent",
  "muted",
  "muted-foreground",
  "border",
  "success",
  "warning",
  "danger",
  "focus",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

export const TYPE_ROLES = [
  "display",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "body",
  "small",
  "caption",
  "label",
  "code",
] as const;

const TYPE_PROPS = ["size", "lineHeight", "weight", "tracking"] as const;
type TypeProp = (typeof TYPE_PROPS)[number];

// DTCG composite typography names for the same four values.
const COMPOSITE_TYPE_PROPS: Record<TypeProp, ReadonlyArray<string>> = {
  size: ["size", "fontSize"],
  lineHeight: ["lineHeight"],
  weight: ["weight", "fontWeight"],
  tracking: ["tracking", "letterSpacing"],
};

const THEMES = ["light", "dark"] as const;
type Theme = (typeof THEMES)[number];

type JsonRecord = { readonly [key: string]: unknown };

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isToken = (value: unknown): value is JsonRecord & { readonly $value: unknown } =>
  isRecord(value) && "$value" in value;

const childKeys = (group: JsonRecord) =>
  Object.keys(group)
    .filter((key) => !key.startsWith("$"))
    .toSorted();

export interface ResolvedTokens {
  readonly color: Readonly<Record<Theme, Readonly<Record<string, string>>>>;
  readonly font: Readonly<Record<string, string>>;
  readonly text: Readonly<Record<string, Readonly<Record<TypeProp, string>>>>;
  readonly space: Readonly<Record<string, string>>;
  readonly radius: Readonly<Record<string, string>>;
  /** Every token by its dotted path, aliases resolved. */
  readonly flat: Readonly<Record<string, unknown>>;
}

export interface TokenReport {
  readonly tokens: ResolvedTokens | undefined;
  readonly errors: ReadonlyArray<BrandIssue>;
  readonly warnings: ReadonlyArray<BrandIssue>;
  readonly contrast: ReadonlyArray<BrandContrastCheck>;
}

const ALIAS = /^\{([^{}]+)\}$/;
const MAX_ALIAS_DEPTH = 16;
// Values land inside CSS declarations; these characters would end or escape one.
const UNSAFE_CSS = /[;{}<>\\\r\n]|\/\*/;

/** `{ value, unit }` is the DTCG dimension object; numbers are taken as pixels or em by role. */
const formatDimension = (value: unknown, numberUnit: string): string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value === 0 || numberUnit === "" ? String(value) : `${value}${numberUnit}`;
  }
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (
    isRecord(value) &&
    typeof value.value === "number" &&
    Number.isFinite(value.value) &&
    typeof value.unit === "string" &&
    /^[a-z%]{0,8}$/i.test(value.unit)
  ) {
    return `${value.value}${value.unit}`;
  }
  return undefined;
};

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
]);

const formatFamily = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  ) {
    return (value as ReadonlyArray<string>)
      .map((item) => item.trim())
      .map((item) =>
        GENERIC_FAMILIES.has(item) || /^["'].*["']$/.test(item) || !/\s/.test(item)
          ? item
          : `"${item}"`,
      )
      .join(", ");
  }
  return undefined;
};

const formatColor = (value: unknown, parsed: ParsedColor): string => {
  if (typeof value === "string") return value.trim();
  if (isRecord(value) && value.colorSpace === "oklch" && Array.isArray(value.components)) {
    return `oklch(${value.components.join(" ")})`;
  }
  if (isRecord(value) && typeof value.hex === "string" && /^#[0-9a-f]{6}$/i.test(value.hex)) {
    return value.hex;
  }
  return toHex(parsed.srgb);
};

/** CSS custom property names take their segment from token keys such as `2xl` or `0.5`. */
const cssName = (key: string) => key.replace(/[^A-Za-z0-9_-]+/g, "-");

const CONTRAST_PAIRS: ReadonlyArray<{
  readonly foreground: ColorRole;
  readonly background: ColorRole;
  readonly minimum: number;
  readonly level: "error" | "warning";
}> = [
  { foreground: "foreground", background: "background", minimum: 4.5, level: "error" },
  { foreground: "primary-foreground", background: "primary", minimum: 4.5, level: "error" },
  { foreground: "muted-foreground", background: "background", minimum: 4.5, level: "error" },
  { foreground: "foreground", background: "muted", minimum: 4.5, level: "error" },
  { foreground: "border", background: "background", minimum: 1.5, level: "warning" },
  { foreground: "focus", background: "background", minimum: 3, level: "error" },
];

/** Checks a parsed `tokens.json` and resolves what the exports need. */
export const readTokens = (document: unknown): TokenReport => {
  const errors: Array<BrandIssue> = [];
  const warnings: Array<BrandIssue> = [];
  const error = (message: string) => errors.push({ path: TOKENS_PATH, message });
  const warn = (message: string) => warnings.push({ path: TOKENS_PATH, message });

  if (!isRecord(document)) {
    error("The file must hold a JSON object.");
    return { tokens: undefined, errors, warnings, contrast: [] };
  }

  const lookup = (dotted: string): unknown => {
    let node: unknown = document;
    for (const segment of dotted.split(".")) {
      if (!isRecord(node) || !(segment in node)) return undefined;
      node = node[segment];
    }
    return node;
  };

  // Follows `{group.token}` aliases to a concrete value; undefined after reporting a broken one.
  const resolve = (value: unknown, at: string): unknown => {
    let current = value;
    const seen = new Set<string>();
    for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth += 1) {
      const alias = typeof current === "string" ? ALIAS.exec(current.trim()) : null;
      if (alias === null) return current;
      const target = alias[1]!;
      if (seen.has(target)) {
        error(`${at} has an alias cycle through {${target}}.`);
        return undefined;
      }
      seen.add(target);
      const node = lookup(target);
      if (!isToken(node)) {
        error(`${at} refers to {${target}}, which is not a token.`);
        return undefined;
      }
      current = node.$value;
    }
    error(`${at} has aliases nested more than ${MAX_ALIAS_DEPTH} deep.`);
    return undefined;
  };

  const css = (value: string | undefined, at: string, kind: string) => {
    if (value === undefined) {
      error(`${at} must be a ${kind}.`);
      return undefined;
    }
    if (UNSAFE_CSS.test(value)) {
      error(`${at} contains characters that are not allowed in a CSS value.`);
      return undefined;
    }
    return value;
  };

  const flat: Record<string, unknown> = {};
  const flatten = (group: JsonRecord, prefix: string) => {
    for (const key of childKeys(group)) {
      const child = group[key];
      const at = prefix === "" ? key : `${prefix}.${key}`;
      if (isToken(child)) flat[at] = resolve(child.$value, at);
      else if (isRecord(child)) flatten(child, at);
    }
  };
  flatten(document, "");

  const group = (dotted: string): JsonRecord | undefined => {
    const node = lookup(dotted);
    if (isRecord(node) && !isToken(node)) return node;
    error(`${dotted} is missing.`);
    return undefined;
  };

  // Each theme's twelve roles must parse as opaque colors.
  const color = { light: {} as Record<string, string>, dark: {} as Record<string, string> };
  const parsedColors: Record<Theme, Map<ColorRole, ParsedColor>> = {
    light: new Map(),
    dark: new Map(),
  };
  for (const theme of THEMES) {
    const roles = group(`color.${theme}`);
    if (roles === undefined) continue;
    for (const role of COLOR_ROLES) {
      const at = `color.${theme}.${role}`;
      const token = roles[role];
      if (!isToken(token)) {
        error(`${at} is missing.`);
        continue;
      }
      const value = resolve(token.$value, at);
      if (value === undefined) continue;
      const parsed = parseColor(value);
      if (parsed === undefined) {
        error(`${at} is not a color we can read. Use #rrggbb, rgb(r g b) or oklch(L C H).`);
        continue;
      }
      if (parsed.clipped) warn(`${at} is outside sRGB; contrast uses its clipped value.`);
      const formatted = css(formatColor(value, parsed), at, "color");
      if (formatted === undefined) continue;
      color[theme][role] = formatted;
      parsedColors[theme].set(role, parsed);
    }
  }

  const font: Record<string, string> = {};
  const families = group("typography.family");
  if (families !== undefined) {
    for (const key of childKeys(families)) {
      const token = families[key];
      if (!isToken(token)) continue;
      const at = `typography.family.${key}`;
      const value = css(formatFamily(resolve(token.$value, at)), at, "font family name or list");
      if (value !== undefined) font[cssName(key)] = value;
    }
    if (childKeys(families).filter((key) => isToken(families[key])).length === 0) {
      error("typography.family needs at least one family.");
    }
  }

  const text: Record<string, Record<TypeProp, string>> = {};
  const typeRoles = group("typography.role");
  if (typeRoles !== undefined) {
    for (const role of TYPE_ROLES) {
      const node = typeRoles[role];
      const at = `typography.role.${role}`;
      if (!isRecord(node)) {
        error(`${at} is missing.`);
        continue;
      }
      const composite = isToken(node) ? resolve(node.$value, at) : undefined;
      const propValue = (prop: TypeProp): unknown => {
        if (isRecord(composite)) {
          const name = COMPOSITE_TYPE_PROPS[prop].find((candidate) => candidate in composite);
          return name === undefined ? undefined : resolve(composite[name], `${at}.${prop}`);
        }
        const token = node[prop];
        return isToken(token) ? resolve(token.$value, `${at}.${prop}`) : undefined;
      };
      const values: Partial<Record<TypeProp, string>> = {};
      for (const prop of TYPE_PROPS) {
        const raw = propValue(prop);
        if (raw === undefined) {
          error(`${at}.${prop} is missing.`);
          continue;
        }
        const formatted =
          prop === "weight"
            ? typeof raw === "number" || typeof raw === "string"
              ? String(raw).trim()
              : undefined
            : formatDimension(raw, prop === "size" ? "px" : prop === "tracking" ? "em" : "");
        const value = css(formatted, `${at}.${prop}`, prop === "weight" ? "weight" : "dimension");
        if (value !== undefined) values[prop] = value;
      }
      if (TYPE_PROPS.every((prop) => values[prop] !== undefined)) {
        text[role] = values as Record<TypeProp, string>;
      }
    }
  }

  const dimensions = (name: "space" | "radius") => {
    const result: Record<string, string> = {};
    const scale = group(name);
    if (scale === undefined) return result;
    const keys = childKeys(scale).filter((key) => isToken(scale[key]));
    if (keys.length === 0) error(`${name} needs at least one token.`);
    for (const key of keys) {
      const token = scale[key];
      if (!isToken(token)) continue;
      const at = `${name}.${key}`;
      const value = css(formatDimension(resolve(token.$value, at), "px"), at, "dimension");
      if (value === undefined) continue;
      const cssKey = cssName(key);
      if (cssKey in result) warn(`${at} has the same CSS name as another ${name} token.`);
      result[cssKey] = value;
    }
    return result;
  };
  const space = dimensions("space");
  const radius = dimensions("radius");

  const contrast: Array<BrandContrastCheck> = [];
  for (const theme of THEMES) {
    for (const pair of CONTRAST_PAIRS) {
      const foreground = parsedColors[theme].get(pair.foreground);
      const background = parsedColors[theme].get(pair.background);
      if (foreground === undefined || background === undefined) continue;
      const ratio = Math.round(contrastRatio(foreground.srgb, background.srgb) * 100) / 100;
      const passes = ratio >= pair.minimum;
      contrast.push({
        theme,
        foreground: pair.foreground,
        background: pair.background,
        ratio,
        minimum: pair.minimum,
        level: pair.level,
        passes,
      });
      if (!passes) {
        (pair.level === "error" ? error : warn)(
          `${theme}: ${pair.foreground} on ${pair.background} is ${ratio}:1; it needs at least ${pair.minimum}:1.`,
        );
      }
    }
  }

  return {
    tokens: errors.length === 0 ? { color, font, text, space, radius, flat } : undefined,
    errors,
    warnings,
    contrast,
  };
};

const HEADER = "Generated by Moonfold from tokens/tokens.json. Do not edit; change the tokens.";

const sortedEntries = <A>(record: Readonly<Record<string, A>>) =>
  Object.keys(record)
    .toSorted()
    .map((key) => [key, record[key]!] as const);

const declarations = (variables: ReadonlyArray<readonly [string, string]>, indent: string) =>
  variables
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join("\n");

const colorVariables = (colors: Readonly<Record<string, string>>) =>
  sortedEntries(colors).map(([role, value]) => [`--color-${role}`, value] as const);

const darkBlocks = (tokens: ResolvedTokens) => {
  const dark = colorVariables(tokens.color.dark);
  return [
    "@media (prefers-color-scheme: dark) {",
    '  :root:not([data-theme="light"]) {',
    declarations(dark, "    "),
    "  }",
    "}",
    "",
    '[data-theme="dark"] {',
    declarations(dark, "  "),
    "}",
  ].join("\n");
};

export const exportCss = (tokens: ResolvedTokens) => {
  const variables = [
    ...colorVariables(tokens.color.light),
    ...sortedEntries(tokens.font).map(([name, value]) => [`--font-${name}`, value] as const),
    ...sortedEntries(tokens.text).flatMap(([role, values]) => [
      [`--text-${role}-size`, values.size] as const,
      [`--text-${role}-line-height`, values.lineHeight] as const,
      [`--text-${role}-weight`, values.weight] as const,
      [`--text-${role}-tracking`, values.tracking] as const,
    ]),
    ...sortedEntries(tokens.space).map(([name, value]) => [`--space-${name}`, value] as const),
    ...sortedEntries(tokens.radius).map(([name, value]) => [`--radius-${name}`, value] as const),
  ];
  return `/* ${HEADER} */\n:root {\n${declarations(variables, "  ")}\n}\n\n${darkBlocks(tokens)}\n`;
};

/** Tailwind v4 theme variables; dark colors override the same variables. */
export const exportTailwind = (tokens: ResolvedTokens) => {
  const variables = [
    ...colorVariables(tokens.color.light),
    ...sortedEntries(tokens.font).map(([name, value]) => [`--font-${name}`, value] as const),
    ...sortedEntries(tokens.text).flatMap(([role, values]) => [
      [`--text-${role}`, values.size] as const,
      [`--text-${role}--line-height`, values.lineHeight] as const,
      [`--text-${role}--font-weight`, values.weight] as const,
      [`--text-${role}--letter-spacing`, values.tracking] as const,
    ]),
    ...sortedEntries(tokens.space).map(([name, value]) => [`--spacing-${name}`, value] as const),
    ...sortedEntries(tokens.radius).map(([name, value]) => [`--radius-${name}`, value] as const),
  ];
  return `/* ${HEADER} */\n@theme {\n${declarations(variables, "  ")}\n}\n\n${darkBlocks(tokens)}\n`;
};

const exportScss = (tokens: ResolvedTokens) => {
  const variables = [
    ...(["light", "dark"] as const).flatMap((theme) =>
      sortedEntries(tokens.color[theme]).map(
        ([role, value]) => [`$color-${theme}-${role}`, value] as const,
      ),
    ),
    ...sortedEntries(tokens.font).map(([name, value]) => [`$font-${name}`, value] as const),
    ...sortedEntries(tokens.text).flatMap(([role, values]) => [
      [`$text-${role}-size`, values.size] as const,
      [`$text-${role}-line-height`, values.lineHeight] as const,
      [`$text-${role}-weight`, values.weight] as const,
      [`$text-${role}-tracking`, values.tracking] as const,
    ]),
    ...sortedEntries(tokens.space).map(([name, value]) => [`$space-${name}`, value] as const),
    ...sortedEntries(tokens.radius).map(([name, value]) => [`$radius-${name}`, value] as const),
  ];
  return `// ${HEADER}\n${declarations(variables, "")}\n`;
};

const sortKeysDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (!isRecord(value)) return value;
  return Object.fromEntries(sortedEntries(value).map(([key, item]) => [key, sortKeysDeep(item)]));
};

export const exportTs = (tokens: ResolvedTokens) => {
  const { flat: _flat, ...structured } = tokens;
  return `// ${HEADER}\nexport const tokens = ${JSON.stringify(sortKeysDeep(structured), null, 2)} as const;\n\nexport type Tokens = typeof tokens;\n`;
};

const exportJson = (tokens: ResolvedTokens) =>
  `${JSON.stringify(sortKeysDeep(tokens.flat), null, 2)}\n`;

/** Every export, by its path relative to the brand folder. */
export const exportFiles = (tokens: ResolvedTokens): ReadonlyArray<readonly [string, string]> => [
  ["exports/tokens.css", exportCss(tokens)],
  ["exports/tailwind.css", exportTailwind(tokens)],
  ["exports/tokens.scss", exportScss(tokens)],
  ["exports/tokens.ts", exportTs(tokens)],
  ["exports/tokens.json", exportJson(tokens)],
];
