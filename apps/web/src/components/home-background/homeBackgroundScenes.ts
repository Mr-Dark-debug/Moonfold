import goldenHourImage from "~/assets/home-backgrounds/golden-hour.png?url";
import moonfoldImage from "~/assets/home-backgrounds/moonfold.png?url";
import purpleWindImage from "~/assets/home-backgrounds/purple-wind.png?url";

import type { HomeBackgroundScene } from "./homeBackground.logic";

interface SceneTone<T> {
  readonly light: T;
  readonly dark: T;
}

export interface HomeBackgroundSceneDefinition {
  /**
   * An emblem is glyph art on a blank field and sits inside the frame. A scene
   * is a picture that fills the frame edge to edge.
   */
  readonly kind: "emblem" | "scene";
  /** Loaded on demand so unused art never reaches the main bundle. */
  readonly loadAscii: () => Promise<string>;
  readonly imageUrl: string;
  /** Text colour for the ASCII drawing. */
  readonly ink: SceneTone<string>;
  /** Strength of the artwork over the page, so text on top stays readable. */
  readonly asciiStrength: SceneTone<number>;
  readonly imageOpacity: SceneTone<number>;
}

export const HOME_BACKGROUND_SCENES: Record<HomeBackgroundScene, HomeBackgroundSceneDefinition> = {
  moonfold: {
    kind: "emblem",
    loadAscii: () => import("~/assets/home-backgrounds/moonfold.txt?raw").then((m) => m.default),
    imageUrl: moonfoldImage,
    ink: { dark: "#c9cdf5", light: "#3b3f78" },
    asciiStrength: { dark: 0.8, light: 1 },
    imageOpacity: { dark: 0.55, light: 0.7 },
  },
  "golden-hour": {
    kind: "scene",
    loadAscii: () => import("~/assets/home-backgrounds/golden-hour.txt?raw").then((m) => m.default),
    imageUrl: goldenHourImage,
    ink: { dark: "#f0b86a", light: "#8a4b10" },
    asciiStrength: { dark: 0.75, light: 1 },
    imageOpacity: { dark: 0.5, light: 0.3 },
  },
  "purple-wind": {
    kind: "scene",
    loadAscii: () => import("~/assets/home-backgrounds/purple-wind.txt?raw").then((m) => m.default),
    imageUrl: purpleWindImage,
    ink: { dark: "#b59cf0", light: "#4b2f8f" },
    asciiStrength: { dark: 0.75, light: 1 },
    imageOpacity: { dark: 0.5, light: 0.35 },
  },
};
