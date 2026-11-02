// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A synchronous asset generator run from the shell.
// Renders every Moonfold icon file the build consumes from one parametric model of the mark
// (docs/BRAND.md): SVG masters in assets/brand, channel PNG/ICO sets in assets/{prod,nightly,dev},
// the Icon Composer layer SVGs, and the development web icons in apps/web/public.
//
//   node scripts/render-brand-icons.ts           write files
//   node scripts/render-brand-icons.ts --check   fail when a tracked file is out of date
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import sharp from "sharp";

import { BRAND_ASSET_PATHS, DEVELOPMENT_PUBLIC_ICON_OVERRIDES } from "./lib/brand-assets.ts";
import { colourMark, monoMark, MOONFOLD_COLORS, placeMark, smallMark } from "./lib/brand-mark.ts";
import { encodePngIco, WINDOWS_ICON_SIZES } from "./lib/icon-export.ts";

const repoRoot = NodePath.resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");

const CHANNEL_BACKGROUNDS = {
  production: { from: "#121B52", to: "#050A24" },
  nightly: { from: "#2C1B57", to: "#100A26" },
  development: { from: "#123A40", to: "#071A1D" },
} as const satisfies Record<string, Background>;

interface Background {
  readonly from: string;
  readonly to: string;
}

/** The full mark spanning `size`, centred on (cx, cy). */
function fullMark(size: number, cx = 512, cy = 512, id = "mf"): string {
  return colourMark(placeMark(size, cx, cy), id);
}

/** Flat mark for favicons and small icon sizes; the smallest sizes get a larger mark and ring. */
function tinyMark(pixelSize: number): string {
  return pixelSize <= 16
    ? smallMark(placeMark(940, 512, 512, false), false, 3.2)
    : smallMark(placeMark(860, 512, 512, false), false);
}

function svg(body: string, size = 1024): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">${body}</svg>\n`;
}

function gradient(id: string, background: Background): string {
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${background.from}"/><stop offset="1" stop-color="${background.to}"/></linearGradient></defs>`;
}

/** Rounded-square icon that fills the canvas (Windows, Linux, web). */
function roundedIcon(background: Background): string {
  return svg(
    `${gradient("bg", background)}<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>${fullMark(780)}`,
  );
}

/** Rounded-square icon drawn for one small pixel size (favicons, small ICO entries). */
function smallIcon(background: Background, pixelSize: number): string {
  return svg(
    `${gradient("bg", background)}<rect width="1024" height="1024" rx="228" fill="url(#bg)"/>${tinyMark(pixelSize)}`,
  );
}

/** Square full-bleed icon, for platforms that apply their own mask. */
function fullBleedIcon(background: Background): string {
  return svg(
    `${gradient("bg", background)}<rect width="1024" height="1024" fill="url(#bg)"/>${fullMark(780)}`,
  );
}

/** macOS pre-Tahoe layout: an 824 body inset 100 with a soft shadow in the transparent margin. */
function macosIcon(background: Background): string {
  return svg(
    `${gradient("bg", background)}<defs><filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">` +
      `<feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.35"/></filter></defs>` +
      `<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)" filter="url(#shadow)"/>` +
      fullMark(630),
  );
}

/** Finder window background for the DMG: light, so Finder's dark icon labels stay readable. */
function dmgBackground(accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="864" viewBox="0 0 640 432">` +
    `<defs><linearGradient id="wash" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#F4F5FA"/><stop offset="1" stop-color="#E4E7F2"/></linearGradient></defs>` +
    `<rect width="640" height="432" fill="url(#wash)"/>` +
    `<path d="M-40 300C120 236 230 316 372 270S560 210 690 262" stroke="${accent}" stroke-opacity="0.18" stroke-width="72" fill="none" stroke-linecap="round"/>` +
    monoMark(placeMark(40, 44, 36), MOONFOLD_COLORS.deep) +
    `<text x="70" y="41" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#1B2254">Moonfold</text>` +
    `</svg>
`
  );
}

/** Icon Composer project: one mark layer over the channel's solid fill. */
function iconComposerProject(fill: string): string {
  const hex = fill.replace("#", "");
  const channel = (offset: number) =>
    (Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(5);
  return `${JSON.stringify(
    {
      fill: { solid: `srgb:${channel(0)},${channel(2)},${channel(4)},1.00000` },
      groups: [
        {
          layers: [
            {
              "image-name": "text.svg",
              name: "Mark",
              position: { scale: 1, "translation-in-points": [0, 0] },
            },
          ],
          shadow: { kind: "neutral", opacity: 0.5 },
          translucency: { enabled: false, value: 0.5 },
        },
      ],
      "supported-platforms": { circles: ["watchOS"], squares: "shared" },
    },
    null,
    2,
  )}
`;
}

interface ChannelOutputs {
  readonly background: Background;
  readonly ios: string;
  readonly macos: string;
  readonly universal?: string;
  readonly windowsIco: string;
  readonly faviconIco: string;
  readonly favicon16: string;
  readonly favicon32: string;
  readonly appleTouch: string;
  readonly iconComposerProject: string;
}

const CHANNELS: ReadonlyArray<ChannelOutputs> = [
  {
    background: CHANNEL_BACKGROUNDS.production,
    ios: BRAND_ASSET_PATHS.productionIosIconPng,
    macos: BRAND_ASSET_PATHS.productionMacIconPng,
    universal: BRAND_ASSET_PATHS.productionLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.productionWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.productionWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.productionWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.productionWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.productionWebAppleTouchIconPng,
    iconComposerProject: BRAND_ASSET_PATHS.productionIconComposerProject,
  },
  {
    background: CHANNEL_BACKGROUNDS.nightly,
    ios: BRAND_ASSET_PATHS.nightlyIosIconPng,
    macos: BRAND_ASSET_PATHS.nightlyMacIconPng,
    universal: BRAND_ASSET_PATHS.nightlyLinuxIconPng,
    windowsIco: BRAND_ASSET_PATHS.nightlyWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.nightlyWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.nightlyWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.nightlyWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.nightlyWebAppleTouchIconPng,
    iconComposerProject: BRAND_ASSET_PATHS.nightlyIconComposerProject,
  },
  {
    background: CHANNEL_BACKGROUNDS.development,
    ios: BRAND_ASSET_PATHS.developmentIosIconPng,
    macos: BRAND_ASSET_PATHS.developmentDesktopIconPng,
    universal: BRAND_ASSET_PATHS.developmentUniversalIconPng,
    windowsIco: BRAND_ASSET_PATHS.developmentWindowsIconIco,
    faviconIco: BRAND_ASSET_PATHS.developmentWebFaviconIco,
    favicon16: BRAND_ASSET_PATHS.developmentWebFavicon16Png,
    favicon32: BRAND_ASSET_PATHS.developmentWebFavicon32Png,
    appleTouch: BRAND_ASSET_PATHS.developmentWebAppleTouchIconPng,
    iconComposerProject: BRAND_ASSET_PATHS.developmentIconComposerProject,
  },
];

async function png(svgText: string, size: number): Promise<Buffer> {
  return sharp(Buffer.from(svgText), { density: Math.max(72, Math.ceil((72 * size) / 1024) * 4) })
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const pending = new Map<string, Buffer>();

// Antivirus scanners on Windows briefly lock files that were just written.
function writeWithRetry(file: string, contents: Buffer): void {
  for (let attempt = 1; ; attempt += 1) {
    try {
      NodeFS.writeFileSync(file, contents);
      return;
    } catch (error) {
      if (attempt >= 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * attempt);
    }
  }
}

function emit(relativePath: string, contents: Buffer | string): void {
  pending.set(relativePath, typeof contents === "string" ? Buffer.from(contents) : contents);
}

async function renderChannel(channel: ChannelOutputs): Promise<void> {
  const rounded = roundedIcon(channel.background);
  emit(channel.ios, await png(fullBleedIcon(channel.background), 1024));
  emit(channel.macos, await png(macosIcon(channel.background), 1024));
  if (channel.universal) emit(channel.universal, await png(rounded, 1024));
  emit(
    channel.windowsIco,
    encodePngIco(
      await Promise.all(
        WINDOWS_ICON_SIZES.map(async (size) => ({
          size,
          contents: await png(size <= 48 ? smallIcon(channel.background, size) : rounded, size),
        })),
      ),
    ),
  );
  emit(
    channel.faviconIco,
    encodePngIco(
      await Promise.all(
        [16, 32, 48].map(async (size) => ({
          size,
          contents: await png(smallIcon(channel.background, size), size),
        })),
      ),
    ),
  );
  emit(channel.favicon16, await png(smallIcon(channel.background, 16), 16));
  emit(channel.favicon32, await png(smallIcon(channel.background, 32), 32));
  emit(channel.appleTouch, await png(fullBleedIcon(channel.background), 180));
  // Icon Composer layer: the mark alone on a transparent canvas; the project supplies the fill.
  emit(`${channel.iconComposerProject}/Assets/text.svg`, svg(fullMark(780)));
  emit(`${channel.iconComposerProject}/icon.json`, iconComposerProject(channel.background.to));
}

const ANDROID_RES = "apps/mobile/app/src/main/res";
/** Launcher layers are 108dp at each density. */
const ANDROID_DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 } as const;

/** The Android launcher layers (the mask keeps the middle 66dp of 108) and the in-app mark. */
async function renderAndroid(): Promise<void> {
  const foreground = svg(fullMark(590));
  const monochrome = svg(monoMark(placeMark(590, 512, 512), "#FFFFFF"));
  for (const [density, size] of Object.entries(ANDROID_DENSITIES)) {
    emit(
      `${ANDROID_RES}/mipmap-${density}/ic_launcher_foreground.png`,
      await png(foreground, size),
    );
    emit(
      `${ANDROID_RES}/mipmap-${density}/ic_launcher_monochrome.png`,
      await png(monochrome, size),
    );
  }
  emit(`${ANDROID_RES}/drawable-nodpi/moonfold_mark.png`, await png(svg(fullMark(940)), 336));
}

function sameJson(left: Buffer, right: Buffer): boolean {
  try {
    return (
      JSON.stringify(JSON.parse(left.toString("utf8"))) ===
      JSON.stringify(JSON.parse(right.toString("utf8")))
    );
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  emit("assets/brand/moonfold-mark.svg", svg(fullMark(940)));
  emit("assets/brand/moonfold-mark-mono.svg", svg(monoMark(placeMark(940, 512, 512), "#000000")));
  emit(
    "assets/brand/moonfold-mark-mono-light.svg",
    svg(monoMark(placeMark(940, 512, 512), "#FFFFFF")),
  );
  emit("assets/brand/moonfold-app-icon.svg", roundedIcon(CHANNEL_BACKGROUNDS.production));
  emit("assets/brand/moonfold-app-icon-macos.svg", macosIcon(CHANNEL_BACKGROUNDS.production));
  for (const channel of CHANNELS) await renderChannel(channel);
  await renderAndroid();
  emit(
    "apps/desktop/resources/dmg/dmg-background-latest.svg",
    dmgBackground(MOONFOLD_COLORS.royal),
  );
  emit("apps/desktop/resources/dmg/dmg-background-nightly.svg", dmgBackground("#7B5CE0"));
  for (const override of DEVELOPMENT_PUBLIC_ICON_OVERRIDES) {
    const source = pending.get(override.sourceRelativePath);
    if (!source) throw new Error(`No rendered source for ${override.sourceRelativePath}`);
    emit(override.targetRelativePath, source);
  }

  const stale: Array<string> = [];
  for (const [relativePath, contents] of pending) {
    const absolute = NodePath.join(repoRoot, relativePath);
    const current = NodeFS.existsSync(absolute) ? NodeFS.readFileSync(absolute) : null;
    if (current !== null && current.equals(contents)) continue;
    // The repository formatter reflows JSON, so compare JSON files by value.
    if (current !== null && relativePath.endsWith(".json") && sameJson(current, contents)) continue;
    if (check) {
      stale.push(relativePath);
      continue;
    }
    NodeFS.mkdirSync(NodePath.dirname(absolute), { recursive: true });
    writeWithRetry(absolute, contents);
    console.log(`wrote ${relativePath}`);
  }
  if (check && stale.length > 0) {
    console.log(`Out of date: ${stale.join(", ")}. Run node scripts/render-brand-icons.ts`);
    process.exitCode = 1;
  }
}

if (import.meta.main) await main();
