import { describe, expect, it } from "vite-plus/test";

import goldenHour from "~/assets/home-backgrounds/golden-hour.txt?raw";
import moonfold from "~/assets/home-backgrounds/moonfold.txt?raw";
import purpleWind from "~/assets/home-backgrounds/purple-wind.txt?raw";

import {
  invertAsciiRamp,
  parseAsciiArt,
  preserveAsciiSpaces,
  splitAsciiTiers,
} from "./homeBackground.logic";

describe("invertAsciiRamp", () => {
  it("mirrors the tones across the span the art uses and leaves newlines alone", () => {
    expect(invertAsciiRamp("@ #\n.")).toBe(" @.\n#");
    // Only `x` through `@` are present, so `@` and `x` trade places and the rest mirror between them.
    expect(invertAsciiRamp("@x")).toBe("x@");
  });

  it("mirroring the shipped scenes twice restores them", () => {
    for (const art of [goldenHour, purpleWind]) {
      expect(invertAsciiRamp(invertAsciiRamp(art))).toBe(art);
    }
  });

  it("only meets characters the art was authored with", () => {
    for (const art of [moonfold, goldenHour, purpleWind]) {
      for (const char of new Set(art.replaceAll("\n", ""))) {
        expect(" .:;-=+xX80S#@", `"${char}"`).toContain(char);
      }
    }
  });
});

describe("parseAsciiArt", () => {
  it("splits rows, ignores trailing newlines and measures the widest row", () => {
    expect(parseAsciiArt("a\r\nbcd\n\n")).toEqual({ rows: ["a", "bcd"], cols: 3 });
  });
});

describe("splitAsciiTiers", () => {
  it("puts each character in its brightness tier and keeps every row the same width", () => {
    expect(splitAsciiTiers("#x0 .")).toEqual(["    .", " x   ", "  0  ", "#    "]);
  });

  it("draws a character outside the ramp at full strength", () => {
    expect(splitAsciiTiers("?")).toEqual([" ", " ", " ", "?"]);
  });
});

describe("preserveAsciiSpaces", () => {
  it("keeps every gap by swapping spaces for no-break spaces", () => {
    expect(preserveAsciiSpaces("a  b")).toBe("a  b");
  });
});
