import { describe, expect, it } from "vite-plus/test";
import { cdp } from "vite-plus/test/browser";

import "~/index.css";
import { render } from "../../../test/render";
import { CouncilGlyph, COUNCIL_SEAT_COUNT, SkillKindGlyph } from "./BrandGlyph";
import { LivingMark, type LivingMarkState } from "./LivingMark";
import { LIVING_MARK as data } from "@moonfold/shared/livingMark";

const SIZE = 200;
const scale = SIZE / data.box;

/** Where the ring's ellipse is, in CSS pixels inside the mark, `degrees` clockwise from its right end. */
function onRing(degrees: number) {
  const { cx, cy, rx, squash, tilt } = data.ring;
  const a = (degrees * Math.PI) / 180;
  const t = (tilt * Math.PI) / 180;
  const u = rx * Math.cos(a);
  const v = rx * squash * Math.sin(a);
  return {
    x: (cx + u * Math.cos(t) - v * Math.sin(t)) * scale,
    y: (cy + u * Math.sin(t) + v * Math.cos(t)) * scale,
  };
}

const opacityOf = (root: Element, selector: string) =>
  getComputedStyle(root.querySelector(selector)!).opacity;

/** The shapes that tell the states apart, as shown or hidden. */
function pose(root: Element) {
  return {
    base: opacityOf(root, ".lm-pose-base"),
    alert: opacityOf(root, ".lm-pose-alert"),
    star: opacityOf(root, ".lm-star"),
    hollow: opacityOf(root, ".lm-star-hollow"),
    dots: opacityOf(root, ".lm-waiting-dots"),
    stillStar: opacityOf(root, ".lm-still-star"),
  };
}

describe("LivingMark", () => {
  it("carries the star along the ring without turning or stretching it", async () => {
    // router: false, the mark needs no routes.
    await using screen = await render(<LivingMark state="working" size={SIZE} />, {
      router: false,
    });
    const mark = screen.container.querySelector(".living-mark")!;
    const traveller = mark.querySelector(".lm-traveller")!;
    const lap = mark.querySelector(".lm-o-lap")!.getAnimations()[0]!;
    const unlap = mark.querySelector(".lm-o-unlap")!.getAnimations()[0]!;
    lap.pause();
    unlap.pause();

    for (const fraction of [0, 0.25, 0.5, 0.75]) {
      lap.currentTime = fraction * 2400;
      unlap.currentTime = fraction * 2400;
      const box = traveller.getBoundingClientRect();
      const origin = mark.getBoundingClientRect();
      const expected = onRing(data.orbit.parked + fraction * 360);
      expect(box.left + box.width / 2 - origin.left, `x at ${fraction}`).toBeCloseTo(expected.x, 0);
      expect(box.top + box.height / 2 - origin.top, `y at ${fraction}`).toBeCloseTo(expected.y, 0);
      // An upright, unstretched star keeps a square box a fifth of the mark wide.
      expect(box.width, `width at ${fraction}`).toBeCloseTo(SIZE * 0.2, 0);
      expect(box.height, `height at ${fraction}`).toBeCloseTo(SIZE * 0.2, 0);
    }
  });

  it("gives every state its own shapes", async () => {
    const poses = new Map<LivingMarkState, ReturnType<typeof pose>>();
    for (const state of ["idle", "working", "waiting", "done", "attention"] as const) {
      // router: false, the mark needs no routes.
      await using screen = await render(<LivingMark state={state} size={SIZE} />, {
        router: false,
      });
      const mark = screen.container.querySelector(".living-mark")!;
      expect(mark.getAttribute("aria-label")).not.toBe("");
      poses.set(state, pose(mark));
    }
    const shown = { base: "1", alert: "0", star: "1", hollow: "0", dots: "0", stillStar: "0" };
    expect(poses.get("idle")).toEqual(shown);
    expect(poses.get("done")).toEqual(shown);
    expect(poses.get("waiting")).toEqual({ ...shown, dots: "1" });
    // While it moves, the travelling star replaces both the parked one and the still one.
    expect(poses.get("working")).toEqual({ ...shown, star: "0" });
    expect(poses.get("attention")).toEqual({
      ...shown,
      base: "0",
      alert: "1",
      star: "0",
      hollow: "1",
    });
  });

  it("keeps every state readable with motion off", async () => {
    const session = cdp();
    await session.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-reduced-motion", value: "reduce" }],
    });
    try {
      for (const state of ["idle", "working", "waiting", "done", "attention"] as const) {
        // router: false, the mark needs no routes.
        await using screen = await render(<LivingMark state={state} size={SIZE} twinkle />, {
          router: false,
        });
        const mark = screen.container.querySelector(".living-mark")!;
        expect(mark.getAnimations({ subtree: true }), state).toEqual([]);
        if (state === "working") {
          // The still star at the ring's far end stands in for the travelling one.
          expect(getComputedStyle(mark.querySelector(".lm-orbit")!).display).toBe("none");
          expect(pose(mark)).toMatchObject({ star: "0", stillStar: "1" });
        }
        if (state === "done") expect(opacityOf(mark, ".lm-rays")).toBe("1");
      }
    } finally {
      await session.send("Emulation.setEmulatedMedia", { features: [] });
    }
  });

  it("draws a different glyph for each seat and each skill kind", async () => {
    const kinds = ["app", "repo", "project", "personal", "system", "other"] as const;
    // router: false, the glyphs need no routes.
    await using screen = await render(
      <div>
        {Array.from({ length: COUNCIL_SEAT_COUNT }, (_, index) => (
          <CouncilGlyph key={index} seat={index + 1} data-seat={index + 1} width={16} height={16} />
        ))}
        <CouncilGlyph seat={COUNCIL_SEAT_COUNT + 1} data-seat="wrapped" width={16} height={16} />
        {kinds.map((kind) => (
          <SkillKindGlyph key={kind} kind={kind} data-kind={kind} width={16} height={16} />
        ))}
      </div>,
      { router: false },
    );
    const shapes = (selector: string) =>
      [...screen.container.querySelectorAll(selector)].map((glyph) =>
        [...glyph.querySelectorAll("path")].map((path) => path.getAttribute("d")).join("|"),
      );
    const seats = shapes("[data-seat]:not([data-seat='wrapped'])");
    expect(new Set(seats).size).toBe(COUNCIL_SEAT_COUNT);
    expect(shapes("[data-seat='wrapped']")[0]).toBe(seats[0]);
    expect(new Set(shapes("[data-kind]")).size).toBe(kinds.length);
  });
});
