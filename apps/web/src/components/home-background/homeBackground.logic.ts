import type { HomeBackground } from "@moonfold/contracts";

export type HomeBackgroundScene = Exclude<HomeBackground, "none">;

/** Characters the bundled art is drawn with, ordered from least to most ink-bright on a dark page. */
const ASCII_RAMP = " .:;-=+xX80S#@";

/**
 * Mirrors tones so art drawn for a dark page reads as a positive image on a light one. The mirror
 * spans only the tones this art uses: a picture without the dimmest characters would otherwise
 * flip to weak ink only. Characters outside the ramp pass through unchanged.
 */
export function invertAsciiRamp(art: string): string {
  let lowest = ASCII_RAMP.length;
  let highest = -1;
  for (const char of art) {
    const index = ASCII_RAMP.indexOf(char);
    if (index < 0) continue;
    lowest = Math.min(lowest, index);
    highest = Math.max(highest, index);
  }
  let flipped = "";
  for (const char of art) {
    const index = ASCII_RAMP.indexOf(char);
    flipped += index < 0 ? char : ASCII_RAMP.charAt(lowest + highest - index);
  }
  return flipped;
}

export interface AsciiGrid {
  readonly rows: ReadonlyArray<string>;
  /** Width of the longest row, in characters. */
  readonly cols: number;
}

export function parseAsciiArt(art: string): AsciiGrid {
  const rows = art.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return { rows, cols: rows.reduce((widest, row) => Math.max(widest, row.length), 0) };
}

/**
 * The four ink tiers, dim to brightest: where each starts in the ramp and how
 * strongly it is drawn relative to the scene's own strength.
 */
const ASCII_TIERS = [
  { from: 0, alpha: 0.2 },
  { from: 6, alpha: 0.4 },
  { from: 9, alpha: 0.65 },
  { from: 12, alpha: 1 },
];
export const ASCII_TIER_ALPHA = ASCII_TIERS.map((tier) => tier.alpha);

/**
 * Splits one row into a string per ink tier, each the same length with every
 * character outside that tier blanked. Drawing each tier at its own strength
 * restores the picture's light and dark, which one flat colour would lose.
 */
export function splitAsciiTiers(row: string): ReadonlyArray<string> {
  const tiers = ASCII_TIERS.map(() => "");
  for (const char of row) {
    const index = ASCII_RAMP.indexOf(char);
    // Characters outside the ramp are drawn at full strength rather than lost.
    const tier =
      index < 0 ? ASCII_TIERS.length - 1 : ASCII_TIERS.findLastIndex((t) => t.from <= index);
    for (let t = 0; t < ASCII_TIERS.length; t++) tiers[t] += t === tier ? char : " ";
  }
  return tiers;
}

/**
 * SVG text collapses runs of ASCII spaces, which would shift every glyph in a
 * row after the first gap. A no-break space keeps the same width and survives.
 */
export function preserveAsciiSpaces(row: string): string {
  return row.replaceAll(" ", " ");
}
