/**
 * The living mark's geometry (docs/plans/mascot.md, D-67), generated from
 * `scripts/lib/brand-mark.ts` by `node scripts/render-brand-icons.ts`. Do not edit the JSON.
 */
import data from "./livingMark.generated.json" with { type: "json" };

export const LIVING_MARK = data;
export const COUNCIL_SEAT_COUNT = data.council.length;

/** The 0-based glyph index for a 1-based seat; seats past the last wrap around. */
export function councilGlyphIndex(seat: number): number {
  return (((Math.trunc(seat) - 1) % COUNCIL_SEAT_COUNT) + COUNCIL_SEAT_COUNT) % COUNCIL_SEAT_COUNT;
}
