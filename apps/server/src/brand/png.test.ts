import { describe, expect, it } from "@effect/vitest";

import { decodePng, downscale, encodePng, isPng, type RgbaImage } from "./png.ts";

const image = (width: number, height: number, pixel: (x: number, y: number) => number[]) => {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) data.set(pixel(x, y), (y * width + x) * 4);
  }
  return { width, height, data } satisfies RgbaImage;
};

describe("png", () => {
  it("round-trips RGBA pixels", () => {
    const source = image(3, 2, (x, y) => [x * 80, y * 120, 200, x === 0 ? 0 : 255]);
    const bytes = encodePng(source);
    expect(isPng(bytes)).toBe(true);
    const decoded = decodePng(bytes);
    expect(decoded?.width).toBe(3);
    expect(decoded?.height).toBe(2);
    expect(Array.from(decoded?.data ?? [])).toEqual(Array.from(source.data));
  });

  it("encodes the same pixels to the same bytes", () => {
    const source = image(5, 5, (x, y) => [x * 50, y * 50, 0, 255]);
    expect(encodePng(source)).toEqual(encodePng(source));
  });

  it("rejects bytes that are not a PNG", () => {
    expect(decodePng(new TextEncoder().encode("<svg/>"))).toBeUndefined();
  });

  it("downscales by averaging covered pixels, keeping the aspect ratio", () => {
    const halves = image(4, 2, (x) => (x < 2 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const scaled = downscale(halves, 2);
    expect(scaled.width).toBe(2);
    expect(scaled.height).toBe(1);
    expect(Array.from(scaled.data)).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    const blended = downscale(halves, 1);
    expect(Array.from(blended.data)).toEqual([128, 0, 128, 255]);
  });

  it("ignores the color of transparent pixels when averaging", () => {
    const edge = image(2, 1, (x) => (x === 0 ? [0, 0, 0, 0] : [255, 255, 255, 255]));
    expect(Array.from(downscale(edge, 1).data)).toEqual([255, 255, 255, 128]);
  });
});
