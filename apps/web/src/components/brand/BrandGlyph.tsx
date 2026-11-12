/* oxlint-disable shadcn/no-raw-colors -- Mask luminance, not colours: white shows, black hides. */
import type { ProviderSkillSourceKind } from "@moonfold/client-runtime/providerSkills";
import { useId, type SVGProps } from "react";

import { cn } from "~/lib/utils";

import {
  COUNCIL_SEAT_COUNT,
  councilGlyphIndex,
  LIVING_MARK as data,
} from "@moonfold/shared/livingMark";

interface GlyphShape {
  readonly d: string;
  readonly paint: string;
  readonly width?: number;
}

/**
 * A small glyph from the brand geometry in `currentColor` (docs/plans/mascot.md). Shapes before a
 * "cut" lose the cut's stroke, so two shapes stay apart in one colour.
 */
function BrandGlyph({
  shapes,
  ...props
}: SVGProps<SVGSVGElement> & { readonly shapes: ReadonlyArray<GlyphShape> }) {
  const id = useId().replaceAll(":", "");
  const firstCut = shapes.findIndex((shape) => shape.paint === "cut");
  const cuts = shapes.filter((shape) => shape.paint === "cut");
  const under = firstCut < 0 ? [] : shapes.slice(0, firstCut);
  const over = (firstCut < 0 ? shapes : shapes.slice(firstCut)).filter(
    (shape) => shape.paint !== "cut",
  );
  const draw = (shape: GlyphShape) =>
    shape.paint === "fill" ? (
      <path key={shape.d} d={shape.d} fill="currentColor" />
    ) : (
      <path
        key={shape.d}
        d={shape.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={shape.width ?? 6}
        strokeLinecap="round"
      />
    );
  return (
    <svg {...props} viewBox={`0 0 ${data.box} ${data.box}`} xmlns="http://www.w3.org/2000/svg">
      {cuts.length === 0 ? null : (
        <defs>
          <mask
            id={`${id}-cut`}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width={data.box}
            height={data.box}
          >
            <rect width={data.box} height={data.box} fill="#fff" />
            {cuts.map((cut) => (
              <path key={cut.d} d={cut.d} fill="none" stroke="#000" strokeWidth={cut.width ?? 8} />
            ))}
          </mask>
        </defs>
      )}
      {under.length === 0 ? null : <g mask={`url(#${id}-cut)`}>{under.map(draw)}</g>}
      {over.map(draw)}
    </svg>
  );
}

export { COUNCIL_SEAT_COUNT };

/**
 * The glyph of one seat in a review round: a moon phase and a star position. It marks the seat,
 * not the provider, whose name must appear as text beside it. Seats past the sixth wrap around.
 */
export function CouncilGlyph({
  seat,
  ...props
}: SVGProps<SVGSVGElement> & {
  /** 1-based seat in the round. */
  readonly seat: number;
}) {
  return (
    <BrandGlyph aria-hidden="true" {...props} shapes={data.council[councilGlyphIndex(seat)]!} />
  );
}

// Each kind differs in shape first; the tint only helps scanning a list.
const SKILL_KIND_TINT: Record<ProviderSkillSourceKind, string> = {
  app: "text-primary",
  repo: "text-info",
  project: "text-success",
  personal: "text-warning",
  system: "text-muted-foreground",
  other: "text-muted-foreground",
};

/** The icon for a skill's source kind. There is no icon per skill (D-67). */
export function SkillKindGlyph({
  kind,
  className,
  ...props
}: SVGProps<SVGSVGElement> & { readonly kind: ProviderSkillSourceKind }) {
  return (
    <BrandGlyph
      aria-hidden="true"
      {...props}
      className={cn(SKILL_KIND_TINT[kind], className)}
      shapes={data.skills[kind]}
    />
  );
}
