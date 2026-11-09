/**
 * Color parsing and WCAG 2.x contrast for brand tokens. Accepts the forms agents write in
 * `tokens.json`: hex (`#rgb`, `#rrggbb`), `rgb()`, `oklch(L C H)`, and the DTCG object form
 * `{ colorSpace: "srgb" | "oklch", components: [...] }`.
 */

/** sRGB channels in 0..1, gamma encoded. */
export interface Srgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface ParsedColor {
  readonly srgb: Srgb;
  /** The source color lies outside sRGB and was clipped to it. */
  readonly clipped: boolean;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

const NUMBER = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?`;

const parseHex = (text: string): ParsedColor | undefined => {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text);
  if (match === null) return undefined;
  const digits = match[1]!;
  const full =
    digits.length === 3
      ? digits
          .split("")
          .map((digit) => digit + digit)
          .join("")
      : digits;
  const channel = (index: number) => Number.parseInt(full.slice(index, index + 2), 16) / 255;
  return { srgb: { r: channel(0), g: channel(2), b: channel(4) }, clipped: false };
};

// `rgb(255 0 0)`, `rgb(255, 0, 0)`, `rgb(100% 0% 0%)`. Alpha is not accepted: contrast needs an opaque color.
const RGB_PATTERN = new RegExp(
  String.raw`^rgb\(\s*(${NUMBER}%?)\s*(?:,\s*|\s+)(${NUMBER}%?)\s*(?:,\s*|\s+)(${NUMBER}%?)\s*\)$`,
  "i",
);

const rgbChannel = (text: string) =>
  text.endsWith("%") ? Number(text.slice(0, -1)) / 100 : Number(text) / 255;

const parseRgb = (text: string): ParsedColor | undefined => {
  const match = RGB_PATTERN.exec(text);
  if (match === null) return undefined;
  const channels = [match[1]!, match[2]!, match[3]!].map(rgbChannel);
  if (channels.some((value) => !Number.isFinite(value))) return undefined;
  const clipped = channels.some((value) => value < 0 || value > 1);
  return {
    srgb: { r: clamp01(channels[0]!), g: clamp01(channels[1]!), b: clamp01(channels[2]!) },
    clipped,
  };
};

const OKLCH_PATTERN = new RegExp(
  String.raw`^oklch\(\s*(${NUMBER}%?)\s+(${NUMBER}%?)\s+(${NUMBER})(?:deg)?\s*\)$`,
  "i",
);

const linearToSrgb = (value: number) =>
  value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;

/** OKLCH to gamma-encoded sRGB, clipped to the sRGB gamut (Björn Ottosson's OKLab matrices). */
const oklchToSrgb = (lightness: number, chroma: number, hueDegrees: number): ParsedColor => {
  const hue = (hueDegrees * Math.PI) / 180;
  const a = chroma * Math.cos(hue);
  const b = chroma * Math.sin(hue);
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  // Rounding noise of in-gamut colors must not count as clipping.
  const clipped = linear.some((value) => value < -1e-4 || value > 1 + 1e-4);
  const [r, g, bl] = linear.map((value) => clamp01(linearToSrgb(clamp01(value))));
  return { srgb: { r: r!, g: g!, b: bl! }, clipped };
};

const parseOklch = (text: string): ParsedColor | undefined => {
  const match = OKLCH_PATTERN.exec(text);
  if (match === null) return undefined;
  const lightnessText = match[1]!;
  const chromaText = match[2]!;
  const lightness = lightnessText.endsWith("%")
    ? Number(lightnessText.slice(0, -1)) / 100
    : Number(lightnessText);
  // CSS Color 4: 100% chroma is 0.4.
  const chroma = chromaText.endsWith("%")
    ? (Number(chromaText.slice(0, -1)) / 100) * 0.4
    : Number(chromaText);
  const hue = Number(match[3]!);
  if (![lightness, chroma, hue].every(Number.isFinite)) return undefined;
  return oklchToSrgb(clamp01(lightness), Math.max(0, chroma), hue);
};

const isNumberArray = (value: unknown): value is ReadonlyArray<number> =>
  Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));

const parseColorObject = (value: object): ParsedColor | undefined => {
  const record = value as { readonly colorSpace?: unknown; readonly components?: unknown };
  const components = record.components;
  if (!isNumberArray(components) || components.length !== 3) return undefined;
  const [first, second, third] = components as readonly [number, number, number];
  if (record.colorSpace === "srgb") {
    const clipped = components.some((channel) => channel < 0 || channel > 1);
    return { srgb: { r: clamp01(first), g: clamp01(second), b: clamp01(third) }, clipped };
  }
  if (record.colorSpace === "oklch") return oklchToSrgb(clamp01(first), Math.max(0, second), third);
  return undefined;
};

/** Parses a token color value; undefined when the form is not one we accept. */
export const parseColor = (value: unknown): ParsedColor | undefined => {
  if (typeof value === "object" && value !== null) return parseColorObject(value);
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  return parseHex(text) ?? parseRgb(text) ?? parseOklch(text);
};

const srgbToLinear = (value: number) =>
  value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);

/** WCAG 2.x relative luminance. */
const relativeLuminance = ({ r, g, b }: Srgb) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

/** WCAG 2.x contrast ratio, 1 to 21. */
export const contrastRatio = (first: Srgb, second: Srgb) => {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

export const toHex = ({ r, g, b }: Srgb) =>
  `#${[r, g, b]
    .map((channel) =>
      Math.round(clamp01(channel) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
