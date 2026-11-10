import type { HomeBackgroundStyle } from "@moonfold/contracts";
import { Suspense, use } from "react";

import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";

import {
  ASCII_TIER_ALPHA,
  invertAsciiRamp,
  parseAsciiArt,
  preserveAsciiSpaces,
  splitAsciiTiers,
  type AsciiGrid,
  type HomeBackgroundScene,
} from "./homeBackground.logic";
import { HOME_BACKGROUND_SCENES } from "./homeBackgroundScenes";

type Appearance = "light" | "dark";

// The art was drawn on cells twice as tall as they are wide, so each text row
// takes two units of height for one unit of width per character.
const CELL_HEIGHT = 2;
// Small enough that any monospace face fits a one-unit cell with spacing to
// spare; `textLength` then pins every row to the exact grid width.
const FONT_SIZE = 1.6;
const BASELINE_OFFSET = 1.55;
const ASCII_FONT_FAMILY =
  'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace';

const asciiGrids = new Map<HomeBackgroundScene, Promise<AsciiGrid | null>>();

/** One promise per scene so React can suspend on it; a failed load is retried on the next mount. */
function loadAsciiGrid(scene: HomeBackgroundScene): Promise<AsciiGrid | null> {
  let grid = asciiGrids.get(scene);
  if (!grid) {
    grid = HOME_BACKGROUND_SCENES[scene].loadAscii().then(parseAsciiArt, () => {
      asciiGrids.delete(scene);
      return null;
    });
    asciiGrids.set(scene, grid);
  }
  return grid;
}

function AsciiDrawing({
  scene,
  appearance,
}: {
  scene: HomeBackgroundScene;
  appearance: Appearance;
}) {
  const definition = HOME_BACKGROUND_SCENES[scene];
  const grid = use(loadAsciiGrid(scene));
  const flip = appearance === "light" && definition.kind === "scene";
  if (!grid) return null;
  // Mirrored as a whole picture, since the flip depends on the tones the art spans.
  const rows = flip ? invertAsciiRamp(grid.rows.join("\n")).split("\n") : grid.rows;
  const split = rows.map(splitAsciiTiers);
  // One layer per ink tier, each holding only the rows that have something to
  // draw in it; `y` is unique within a layer and doubles as the key.
  const layers = ASCII_TIER_ALPHA.map((alpha, tier) => ({
    alpha,
    lines: split.flatMap((tiers, index) => {
      const text = tiers[tier];
      return text?.trim()
        ? [{ y: index * CELL_HEIGHT + BASELINE_OFFSET, text: preserveAsciiSpaces(text) }]
        : [];
    }),
  }));
  const strength = definition.asciiStrength[appearance];

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${grid.cols} ${grid.rows.length * CELL_HEIGHT}`}
      preserveAspectRatio={definition.kind === "scene" ? "xMidYMid slice" : "xMidYMid meet"}
      // An SVG with only a viewBox does not stretch between insets, so the emblem gets a sized box.
      className={
        definition.kind === "emblem" ? "absolute top-[18%] left-[10%] h-[64%] w-[80%]" : "size-full"
      }
      fill="currentColor"
      style={{ color: definition.ink[appearance] }}
    >
      {layers.map(({ alpha, lines }) => (
        <g key={alpha} fillOpacity={alpha * strength}>
          {lines.map(({ y, text }) => (
            <text
              key={y}
              x={0}
              y={y}
              fontFamily={ASCII_FONT_FAMILY}
              fontSize={FONT_SIZE}
              textLength={text.length}
              lengthAdjust="spacing"
            >
              {text}
            </text>
          ))}
        </g>
      ))}
    </svg>
  );
}

function ImageDrawing({
  scene,
  appearance,
}: {
  scene: HomeBackgroundScene;
  appearance: Appearance;
}) {
  const definition = HOME_BACKGROUND_SCENES[scene];
  const isEmblem = definition.kind === "emblem";
  return (
    <img
      alt=""
      aria-hidden="true"
      decoding="async"
      draggable={false}
      src={definition.imageUrl}
      className={cn("absolute inset-0 size-full", isEmblem ? "object-contain" : "object-cover")}
      // The emblem PNG is light glyphs on an opaque near-black frame. Lighten
      // (or darken, after inverting for a light page) keeps only the glyphs,
      // and the filter pushes the frame to pure black or white so it cannot
      // show as a box on a page darker or lighter than the frame itself.
      style={{
        opacity: definition.imageOpacity[appearance],
        ...(isEmblem
          ? appearance === "dark"
            ? { filter: "contrast(1.25)", mixBlendMode: "lighten" }
            : { filter: "invert(1) brightness(1.05)", mixBlendMode: "darken" }
          : {}),
      }}
    />
  );
}

/**
 * The artwork on its own surface. It paints the page colour underneath so the
 * emblem's blend stays inside this box, and the box fills whatever positioned
 * parent it is placed in.
 */
export function HomeBackgroundCanvas({
  scene,
  style,
  appearance,
  className,
}: {
  scene: HomeBackgroundScene;
  style: HomeBackgroundStyle;
  appearance: Appearance;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 isolate overflow-hidden bg-background",
        className,
      )}
      data-home-background={scene}
      data-home-background-style={style}
    >
      {style === "image" ? (
        <ImageDrawing scene={scene} appearance={appearance} />
      ) : (
        <Suspense fallback={null}>
          <AsciiDrawing scene={scene} appearance={appearance} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * The new-thread screen's backdrop, driven by the Appearance settings. A soft
 * wash of the page colour sits over the middle, where the headline and the
 * composer are, so text on top keeps its contrast whatever the artwork is.
 */
export function HomeBackgroundLayer() {
  const scene = useClientSettings((settings) => settings.homeBackground);
  const style = useClientSettings((settings) => settings.homeBackgroundStyle);
  const { resolvedTheme } = useTheme();
  if (scene === "none") return null;

  return (
    <div className="home-background-layer pointer-events-none absolute inset-0">
      <HomeBackgroundCanvas scene={scene} style={style} appearance={resolvedTheme} />
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 65% 55% at 50% 50%, color-mix(in srgb, var(--background) 78%, transparent), transparent)",
        }}
      />
    </div>
  );
}
