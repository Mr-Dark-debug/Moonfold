import { describe, expect, it } from "@effect/vitest";

import { contrastRatio, parseColor, toHex } from "./color.ts";

const hexOf = (value: unknown) => {
  const parsed = parseColor(value);
  return parsed === undefined ? undefined : toHex(parsed.srgb);
};

describe("parseColor", () => {
  it("reads hex, rgb() and the DTCG srgb object", () => {
    expect(hexOf("#fff")).toBe("#ffffff");
    expect(hexOf("#1D4ED8")).toBe("#1d4ed8");
    expect(hexOf("rgb(29, 78, 216)")).toBe("#1d4ed8");
    expect(hexOf("rgb(29 78 216)")).toBe("#1d4ed8");
    expect(hexOf("rgb(100% 0% 0%)")).toBe("#ff0000");
    expect(hexOf({ colorSpace: "srgb", components: [1, 0.5, 0] })).toBe("#ff8000");
  });

  it("converts oklch to sRGB", () => {
    expect(hexOf("oklch(1 0 0)")).toBe("#ffffff");
    expect(hexOf("oklch(0 0 0)")).toBe("#000000");
    // Reference values from the CSS Color 4 conversion of pure sRGB primaries.
    expect(hexOf("oklch(0.6279554 0.2576833 29.2338851)")).toBe("#ff0000");
    expect(hexOf("oklch(45.2% 0.3132 264.05deg)")).toBe("#0000ff");
    expect(hexOf({ colorSpace: "oklch", components: [0.8664, 0.2948, 142.5] })).toBe("#00ff00");
    expect(parseColor("oklch(0.7 0.1 200)")?.clipped).toBe(false);
  });

  it("flags oklch colors outside sRGB as clipped", () => {
    expect(parseColor("oklch(0.9 0.4 145)")?.clipped).toBe(true);
  });

  it("rejects forms contrast cannot use", () => {
    for (const value of ["#ff000080", "rgba(0,0,0,0.5)", "red", "hsl(0 100% 50%)", "", 12, null]) {
      expect(parseColor(value)).toBeUndefined();
    }
  });
});

describe("contrastRatio", () => {
  const ratio = (first: string, second: string) =>
    Math.round(contrastRatio(parseColor(first)!.srgb, parseColor(second)!.srgb) * 100) / 100;

  it("matches the WCAG reference values", () => {
    expect(ratio("#000000", "#ffffff")).toBe(21);
    expect(ratio("#ffffff", "#ffffff")).toBe(1);
    expect(ratio("#767676", "#ffffff")).toBe(4.54);
    expect(ratio("#ffffff", "#767676")).toBe(4.54);
  });
});
