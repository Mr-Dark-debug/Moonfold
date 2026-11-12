/**
 * The Moonfold mark (docs/BRAND.md): a crescent moon inside a tilted orbit ring, with a four-point
 * star on the ring. One parametric model, drawn as SVG fragments for every icon, the social image
 * and the docs site. Units are the moon's radius; `size` is the width the whole mark spans.
 */

// Geometry in units of the moon's radius, the moon centred at the origin.
const SHADOW = { cx: 0.28, cy: -0.29, r: 0.745 } as const;
const RING = { cx: 0.02, cy: -0.15, rx: 1.5, ry: 0.3, angle: -21.6, width: 0.045 } as const;
const STAR = { cx: 0.9, cy: -0.8, h: 0.44, w: 0.29 } as const;

export const MOONFOLD_COLORS = {
  ink: "#050A24",
  inkLight: "#121B52",
  moonlight: "#EEF1FF",
  periwinkle: "#8C9BFF",
  royal: "#3D4FE6",
  deep: "#1C2690",
  shadow: "#060B26",
  shadowRim: "#141E66",
} as const;

function round(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/** Extent of the full mark (moon, ring and star) in moon radii, used to centre and scale it. */
function markBounds(withStar: boolean): { minX: number; maxX: number; minY: number; maxY: number } {
  const t = (RING.angle * Math.PI) / 180;
  const halfX = Math.hypot(RING.rx * Math.cos(t), RING.ry * Math.sin(t));
  const halfY = Math.hypot(RING.rx * Math.sin(t), RING.ry * Math.cos(t));
  const ringPad = RING.width / 2;
  let minX = Math.min(-1, RING.cx - halfX - ringPad);
  let maxX = Math.max(1, RING.cx + halfX + ringPad);
  let minY = Math.min(-1, RING.cy - halfY - ringPad);
  let maxY = Math.max(1, RING.cy + halfY + ringPad);
  if (withStar) {
    minX = Math.min(minX, STAR.cx - STAR.w);
    maxX = Math.max(maxX, STAR.cx + STAR.w);
    minY = Math.min(minY, STAR.cy - STAR.h);
    maxY = Math.max(maxY, STAR.cy + STAR.h);
  }
  return { minX, maxX, minY, maxY };
}

interface Placement {
  /** Moon radius in output units. */
  readonly r: number;
  /** Moon centre in output units. */
  readonly x: number;
  readonly y: number;
}

/** Scales the mark so its widest side spans `size`, centred on (cx, cy). */
export function placeMark(size: number, cx: number, cy: number, withStar = true): Placement {
  const b = markBounds(withStar);
  const r = size / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  return { r, x: cx - ((b.minX + b.maxX) / 2) * r, y: cy - ((b.minY + b.maxY) / 2) * r };
}

function ringArc(p: Placement, half: "back" | "front" | "full"): string {
  const rx = RING.rx * p.r;
  const ry = RING.ry * p.r;
  const cx = p.x + RING.cx * p.r;
  const cy = p.y + RING.cy * p.r;
  const t = `rotate(${RING.angle} ${round(cx)} ${round(cy)})`;
  const left = `${round(cx - rx)} ${round(cy)}`;
  const right = `${round(cx + rx)} ${round(cy)}`;
  // In SVG's y-down frame, sweep 0 from left to right passes below the centre: the front half.
  const d =
    half === "front"
      ? `M ${left} A ${round(rx)} ${round(ry)} 0 0 0 ${right}`
      : half === "back"
        ? `M ${left} A ${round(rx)} ${round(ry)} 0 0 1 ${right}`
        : `M ${left} A ${round(rx)} ${round(ry)} 0 0 1 ${right} A ${round(rx)} ${round(ry)} 0 0 1 ${left} Z`;
  return `<path d="${d}" transform="${t}"`;
}

function starPath(p: Placement, scale = 1): string {
  const cx = p.x + STAR.cx * p.r;
  const cy = p.y + STAR.cy * p.r;
  const h = STAR.h * p.r * scale;
  const w = STAR.w * p.r * scale;
  const c = Math.min(w, h) * 0.055;
  const pt = (x: number, y: number) => `${round(cx + x)} ${round(cy + y)}`;
  return (
    `M ${pt(0, -h)} Q ${pt(c, -c)} ${pt(w, 0)} Q ${pt(c, c)} ${pt(0, h)} ` +
    `Q ${pt(-c, c)} ${pt(-w, 0)} Q ${pt(-c, -c)} ${pt(0, -h)} Z`
  );
}

/**
 * The full-colour mark with glow. `id` prefixes gradient and filter ids so several marks can share
 * one document.
 */
export function colourMark(p: Placement, id = "mf"): string {
  const r = p.r;
  const moon = `${round(p.x)}`;
  const glow = round(r * 0.035);
  const shadowX = round(p.x + SHADOW.cx * r);
  const shadowY = round(p.y + SHADOW.cy * r);
  const ringWidth = round(RING.width * r);
  return (
    `<defs>` +
    `<linearGradient id="${id}-moon" x1="0.15" y1="0.1" x2="0.85" y2="0.95">` +
    `<stop offset="0" stop-color="${MOONFOLD_COLORS.moonlight}"/>` +
    `<stop offset="0.45" stop-color="${MOONFOLD_COLORS.periwinkle}"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.royal}"/></linearGradient>` +
    `<radialGradient id="${id}-shade" cx="0.4" cy="0.35" r="0.75">` +
    `<stop offset="0.6" stop-color="${MOONFOLD_COLORS.shadow}"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.shadowRim}"/></radialGradient>` +
    `<radialGradient id="${id}-spark"><stop offset="0" stop-color="${MOONFOLD_COLORS.periwinkle}" stop-opacity="0.7"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.royal}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}-halo"><stop offset="0.55" stop-color="${MOONFOLD_COLORS.royal}" stop-opacity="0.35"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.royal}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="${id}-ring" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="${MOONFOLD_COLORS.periwinkle}"/><stop offset="0.5" stop-color="#FFFFFF"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.moonlight}"/></linearGradient>` +
    `<filter id="${id}-glow" x="-50%" y="-50%" width="200%" height="200%">` +
    `<feGaussianBlur stdDeviation="${glow}" result="b"/>` +
    `<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>` +
    `<clipPath id="${id}-disc"><circle cx="${moon}" cy="${round(p.y)}" r="${round(r)}"/></clipPath>` +
    `</defs>` +
    // A soft halo behind the moon.
    `<circle cx="${moon}" cy="${round(p.y)}" r="${round(r * 1.32)}" fill="url(#${id}-halo)"/>` +
    // The back of the ring, hidden where the moon passes in front of it.
    `${ringArc(p, "back")} fill="none" stroke="url(#${id}-ring)" stroke-width="${ringWidth}" stroke-linecap="round" filter="url(#${id}-glow)"/>` +
    // The moon: lit disc, then the shadowed part, leaving a crescent.
    `<g clip-path="url(#${id}-disc)">` +
    `<circle cx="${moon}" cy="${round(p.y)}" r="${round(r)}" fill="url(#${id}-moon)" filter="url(#${id}-glow)"/>` +
    `<circle cx="${shadowX}" cy="${shadowY}" r="${round(SHADOW.r * r)}" fill="url(#${id}-shade)"/>` +
    `</g>` +
    // The front of the ring, over the moon.
    `${ringArc(p, "front")} fill="none" stroke="url(#${id}-ring)" stroke-width="${ringWidth}" stroke-linecap="round" filter="url(#${id}-glow)"/>` +
    `<circle cx="${round(p.x + STAR.cx * r)}" cy="${round(p.y + STAR.cy * r)}" r="${round(STAR.h * r * 0.75)}" fill="url(#${id}-spark)"/>` +
    `<path d="${starPath(p)}" fill="#FFFFFF" filter="url(#${id}-glow)"/>`
  );
}

/**
 * A flat mark for small sizes (favicons, 16 to 48 px): no glow or halo, a thicker ring, and the
 * star only when there is room for it.
 */
export function smallMark(p: Placement, withStar: boolean, ringScale = 2.1, id = "mfs"): string {
  const r = p.r;
  const ringWidth = round(RING.width * r * ringScale);
  return (
    `<defs><linearGradient id="${id}-moon" x1="0.15" y1="0.1" x2="0.85" y2="0.95">` +
    `<stop offset="0" stop-color="${MOONFOLD_COLORS.moonlight}"/>` +
    `<stop offset="1" stop-color="${MOONFOLD_COLORS.periwinkle}"/></linearGradient>` +
    `<clipPath id="${id}-disc"><circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(r)}"/></clipPath></defs>` +
    `${ringArc(p, "back")} fill="none" stroke="${MOONFOLD_COLORS.moonlight}" stroke-width="${ringWidth}" stroke-linecap="round"/>` +
    `<g clip-path="url(#${id}-disc)"><circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(r)}" fill="url(#${id}-moon)"/>` +
    `<circle cx="${round(p.x + SHADOW.cx * r)}" cy="${round(p.y + SHADOW.cy * r)}" r="${round(SHADOW.r * r)}" fill="${MOONFOLD_COLORS.shadow}"/></g>` +
    `${ringArc(p, "front")} fill="none" stroke="#FFFFFF" stroke-width="${ringWidth}" stroke-linecap="round"/>` +
    (withStar ? `<path d="${starPath(p, 1.15)}" fill="#FFFFFF"/>` : "")
  );
}

/**
 * The mark in one colour: crescent, ring and star, with a gap cut along the ring where it crosses
 * the crescent so the shapes stay apart without a second colour.
 */
export function monoMark(p: Placement, colour: string, id = "mfm"): string {
  const r = p.r;
  const ringWidth = round(RING.width * r * 1.6);
  const gap = round(RING.width * r * 4.2);
  return (
    `<defs>` +
    `<mask id="${id}-crescent" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">` +
    `<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(r)}" fill="#fff"/>` +
    `<circle cx="${round(p.x + SHADOW.cx * r)}" cy="${round(p.y + SHADOW.cy * r)}" r="${round(SHADOW.r * r)}" fill="#000"/>` +
    `${ringArc(p, "front")} fill="none" stroke="#000" stroke-width="${gap}"/></mask>` +
    `<mask id="${id}-back" maskUnits="userSpaceOnUse" x="-5000" y="-5000" width="10000" height="10000">` +
    `<rect x="-5000" y="-5000" width="10000" height="10000" fill="#fff"/>` +
    `<circle cx="${round(p.x)}" cy="${round(p.y)}" r="${round(r + RING.width * r * 2)}" fill="#000"/></mask>` +
    `</defs>` +
    `<g fill="${colour}" stroke="${colour}">` +
    `<rect x="-5000" y="-5000" width="10000" height="10000" mask="url(#${id}-crescent)" stroke="none"/>` +
    `<g mask="url(#${id}-back)">${ringArc(p, "back")} fill="none" stroke-width="${ringWidth}" stroke-linecap="round"/></g>` +
    `${ringArc(p, "front")} fill="none" stroke-width="${ringWidth}" stroke-linecap="round"/>` +
    `<path d="${starPath(p)}" stroke="none"/>` +
    `</g>`
  );
}

/** One shape of a small glyph: a filled path, a stroked one, or a stroke cut out of what is under it. */
export interface GlyphShape {
  readonly d: string;
  readonly paint: "fill" | "stroke" | "cut";
  readonly width?: number;
}

const LIVING_BOX = 100;
/** Placed smaller than in `MoonfoldMark`, so the star stays inside the box all the way round. */
const LIVING_SPAN = 84;
export const COUNCIL_SEATS = 6;
export const SKILL_GLYPH_KINDS = ["app", "repo", "project", "personal", "system", "other"] as const;

function fourPointStar(h: number, w: number): string {
  const c = Math.min(w, h) * 0.055;
  const pt = (x: number, y: number) => `${round(x)} ${round(y)}`;
  return (
    `M ${pt(0, -h)} Q ${pt(c, -c)} ${pt(w, 0)} Q ${pt(c, c)} ${pt(0, h)} ` +
    `Q ${pt(-c, c)} ${pt(-w, 0)} Q ${pt(-c, -c)} ${pt(0, -h)} Z`
  );
}

/** A moon phase as one path: the lit limb on the right, the terminator bulging by `bulge` (-1 to 1). */
function phasePath(cx: number, cy: number, r: number, bulge: number, mirrored: boolean): string {
  if (bulge >= 1) {
    return (
      `M ${round(cx - r)} ${round(cy)} A ${round(r)} ${round(r)} 0 1 0 ${round(cx + r)} ${round(cy)} ` +
      `A ${round(r)} ${round(r)} 0 1 0 ${round(cx - r)} ${round(cy)} Z`
    );
  }
  const side = mirrored ? 0 : 1;
  const terminator = round(Math.abs(bulge) * r);
  // The terminator curves towards the limb for a crescent and away from it for a gibbous moon.
  const sweep = bulge < 0 === mirrored ? 1 : 0;
  return (
    `M ${round(cx)} ${round(cy - r)} A ${round(r)} ${round(r)} 0 0 ${side} ${round(cx)} ${round(cy + r)} ` +
    `A ${terminator} ${round(r)} 0 0 ${sweep} ${round(cx)} ${round(cy - r)} Z`
  );
}

// Star paths use absolute commands with coordinate pairs only, so shifting every pair is safe.
function translated(d: string, x: number, y: number): string {
  return d.replaceAll(
    /(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g,
    (_, px: string, py: string) => `${round(Number(px) + x)} ${round(Number(py) + y)}`,
  );
}

const COUNCIL_PHASES = [
  [-0.3, false],
  [0, false],
  [0.55, false],
  [1, false],
  [0, true],
  [-0.3, true],
] as const;
const COUNCIL_STAR_DEGREES = [-50, 0, 50, 130, 180, 230] as const;

/**
 * Everything the living mark, the council glyphs and the skill icons are drawn from
 * (docs/plans/mascot.md), in a 100-unit box. The web client imports the generated copy.
 */
export function livingMarkData() {
  const p = placeMark(LIVING_SPAN, LIVING_BOX / 2, LIVING_BOX / 2);
  const r = p.r;
  const tilt = (RING.angle * Math.PI) / 180;
  const ring = { cx: p.x + RING.cx * r, cy: p.y + RING.cy * r, rx: RING.rx * r, ry: RING.ry * r };
  const arc = (sweep: 0 | 1) =>
    `M ${round(ring.cx - ring.rx)} ${round(ring.cy)} A ${round(ring.rx)} ${round(ring.ry)} 0 0 ${sweep} ${round(ring.cx + ring.rx)} ${round(ring.cy)}`;
  // A point of the ring's ellipse, `degrees` clockwise on screen from its right-hand end.
  const onRing = (degrees: number) => {
    const a = (degrees * Math.PI) / 180;
    const u = ring.rx * Math.cos(a);
    const v = ring.ry * Math.sin(a);
    return {
      x: ring.cx + u * Math.cos(tilt) - v * Math.sin(tilt),
      y: ring.cy + u * Math.sin(tilt) + v * Math.cos(tilt),
    };
  };
  const star = { x: p.x + STAR.cx * r, y: p.y + STAR.cy * r, h: STAR.h * r, w: STAR.w * r };

  // Where on the ring the star's own place is nearest, so a lap starts and ends beside it.
  const du = star.x - ring.cx;
  const dv = star.y - ring.cy;
  const u = du * Math.cos(tilt) + dv * Math.sin(tilt);
  const v = -du * Math.sin(tilt) + dv * Math.cos(tilt);
  const parked = (Math.atan2(v / ring.ry, u / ring.rx) * 180) / Math.PI;

  // The part of a lap, in percent of its time, where the star is behind the moon's disc.
  const behind = (degrees: number) => {
    const point = onRing(degrees);
    const normalized = ((degrees % 360) + 360) % 360;
    return normalized > 180 && Math.hypot(point.x - p.x, point.y - p.y) < r * 1.02;
  };
  let hideFrom = -1;
  let hideTo = -1;
  for (let step = 0; step <= 1000; step += 1) {
    const hidden = behind(parked + (step / 1000) * 360);
    if (hidden && hideFrom < 0) hideFrom = step / 10;
    if (hidden) hideTo = step / 10;
  }

  // The ring's open left end, across the mark from the star's own place and clear of the moon.
  const still = onRing(170);
  const rays = [45, 135, 225, 315].map((degrees) => {
    const a = (degrees * Math.PI) / 180;
    const from = star.h * 0.62;
    const to = star.h * 1.05;
    return `M ${round(Math.cos(a) * from)} ${round(Math.sin(a) * from)} L ${round(Math.cos(a) * to)} ${round(Math.sin(a) * to)}`;
  });

  const seatStar = fourPointStar(12, 8.5);
  const council = COUNCIL_PHASES.map(([bulge, mirrored], index): ReadonlyArray<GlyphShape> => {
    const angle = (COUNCIL_STAR_DEGREES[index]! * Math.PI) / 180;
    return [
      { d: phasePath(50, 50, 28, bulge, mirrored), paint: "fill" },
      {
        d: translated(seatStar, 50 + Math.cos(angle) * 40, 50 + Math.sin(angle) * 40),
        paint: "fill",
      },
    ];
  });

  const skillRing = "M 12 62 A 40 9 -21.6 1 0 88 38 A 40 9 -21.6 1 0 12 62 Z";
  const skills: Record<(typeof SKILL_GLYPH_KINDS)[number], ReadonlyArray<GlyphShape>> = {
    app: [
      { d: phasePath(50, 52, 29, 0.45, true), paint: "fill" },
      { d: skillRing, paint: "cut", width: 15 },
      { d: skillRing, paint: "stroke", width: 7 },
    ],
    repo: [{ d: phasePath(38, 50, 38, -0.15, false), paint: "fill" }],
    project: [
      { d: skillRing, paint: "stroke", width: 8 },
      { d: phasePath(50, 50, 11, 1, false), paint: "fill" },
    ],
    personal: [{ d: translated(fourPointStar(44, 30), 50, 50), paint: "fill" }],
    system: [
      { d: phasePath(50, 50, 34, 1, false), paint: "fill" },
      { d: skillRing, paint: "cut", width: 9 },
    ],
    other: [
      { d: "M 16 74 A 52 52 0 0 1 66 22", paint: "stroke", width: 8 },
      { d: phasePath(76, 24, 11, 1, false), paint: "fill" },
    ],
  };

  const n = (value: number) => Number(round(value));
  return {
    box: LIVING_BOX,
    moon: { cx: n(p.x), cy: n(p.y), r: n(r) },
    shadow: { cx: n(p.x + SHADOW.cx * r), cy: n(p.y + SHADOW.cy * r), r: n(SHADOW.r * r) },
    ring: {
      cx: n(ring.cx),
      cy: n(ring.cy),
      rx: n(ring.rx),
      tilt: RING.angle,
      // Ring height over width: with the radius, all the star's orbit needs.
      squash: Number((RING.ry / RING.rx).toFixed(4)),
      back: arc(1),
      front: arc(0),
      width: n(r * 0.148),
      widthSmall: n(r * 0.215),
      gap: n(r * 0.33),
      hideBehind: n(r * 1.09),
    },
    star: {
      x: n(star.x),
      y: n(star.y),
      d: fourPointStar(star.h, star.w),
      traveller: fourPointStar(star.h * 0.72, star.w * 0.72),
      rays: rays.join(" "),
    },
    orbit: {
      parked: Number(parked.toFixed(2)),
      hideFrom: Number(hideFrom.toFixed(1)),
      hideTo: Number(hideTo.toFixed(1)),
      still: { x: n(still.x), y: n(still.y) },
    },
    // Two dots beside the parked star, in the empty sky above the moon: "…", waiting for you.
    waiting: [0.62, 1.12].map((back) => ({
      x: n(star.x - star.w - r * back),
      y: n(star.y - star.h * 0.35),
      r: n(r * 0.12),
    })),
    council,
    skills,
  };
}

export const LIVING_MARK_STATES = ["idle", "working", "waiting", "done", "attention"] as const;
export type LivingMarkState = (typeof LIVING_MARK_STATES)[number];

/** The still pose of one state, as a complete SVG: what reduced motion shows, and the docs site. */
export function livingMarkStill(state: LivingMarkState, colour: string, id = "lm"): string {
  const data = livingMarkData();
  const { moon, shadow, ring, star, orbit, waiting } = data;
  const tilt = state === "attention" ? 0 : ring.tilt;
  const turn = `transform="rotate(${tilt} ${ring.cx} ${ring.cy})"`;
  const starAt = (x: number, y: number, d: string, hollow: boolean) =>
    hollow
      ? `<path d="${d}" transform="translate(${x} ${y}) scale(0.82)" fill="none" stroke="${colour}" stroke-width="2.6" stroke-linejoin="round"/>`
      : `<path d="${d}" transform="translate(${x} ${y})" fill="${colour}"/>`;
  const extras =
    state === "working"
      ? starAt(orbit.still.x, orbit.still.y, star.traveller, false)
      : starAt(star.x, star.y, star.d, state === "attention") +
        (state === "waiting"
          ? waiting
              .map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${colour}"/>`)
              .join("")
          : "") +
        (state === "done"
          ? `<path d="${star.rays}" transform="translate(${star.x} ${star.y})" fill="none" stroke="${colour}" stroke-width="2.2" stroke-linecap="round"/>`
          : "");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${data.box} ${data.box}">` +
    `<defs>` +
    `<mask id="${id}-crescent" maskUnits="userSpaceOnUse" x="0" y="0" width="${data.box}" height="${data.box}">` +
    `<circle cx="${moon.cx}" cy="${moon.cy}" r="${moon.r}" fill="#fff"/>` +
    `<circle cx="${shadow.cx}" cy="${shadow.cy}" r="${shadow.r}" fill="#000"/>` +
    `<path d="${ring.front}" ${turn} fill="none" stroke="#000" stroke-width="${ring.gap}"/></mask>` +
    `<mask id="${id}-back" maskUnits="userSpaceOnUse" x="0" y="0" width="${data.box}" height="${data.box}">` +
    `<rect width="${data.box}" height="${data.box}" fill="#fff"/>` +
    `<circle cx="${moon.cx}" cy="${moon.cy}" r="${ring.hideBehind}" fill="#000"/></mask>` +
    `</defs>` +
    `<rect width="${data.box}" height="${data.box}" fill="${colour}" mask="url(#${id}-crescent)"/>` +
    `<g fill="none" stroke="${colour}" stroke-width="${ring.width}" stroke-linecap="round">` +
    `<g mask="url(#${id}-back)"><path d="${ring.back}" ${turn}/></g>` +
    `<path d="${ring.front}" ${turn}/></g>` +
    extras +
    `</svg>`
  );
}

/** A council or skill glyph as a complete SVG in one colour. */
export function glyphSvg(shapes: ReadonlyArray<GlyphShape>, colour: string, id = "gl"): string {
  const cuts = shapes.filter((shape) => shape.paint === "cut");
  const draw = (shape: GlyphShape) =>
    shape.paint === "fill"
      ? `<path d="${shape.d}" fill="${colour}"/>`
      : `<path d="${shape.d}" fill="none" stroke="${colour}" stroke-width="${shape.width ?? 6}" stroke-linecap="round"/>`;
  // Fills drawn before a cut lose the cut's stroke; shapes after it are drawn whole.
  const firstCut = shapes.findIndex((shape) => shape.paint === "cut");
  const under = firstCut < 0 ? [] : shapes.slice(0, firstCut);
  const over = (firstCut < 0 ? shapes : shapes.slice(firstCut)).filter(
    (shape) => shape.paint !== "cut",
  );
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LIVING_BOX} ${LIVING_BOX}">` +
    (cuts.length === 0
      ? ""
      : `<defs><mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="${LIVING_BOX}" height="${LIVING_BOX}">` +
        `<rect width="${LIVING_BOX}" height="${LIVING_BOX}" fill="#fff"/>` +
        cuts
          .map(
            (cut) =>
              `<path d="${cut.d}" fill="none" stroke="#000" stroke-width="${cut.width ?? 8}"/>`,
          )
          .join("") +
        `</mask></defs>`) +
    (under.length === 0 ? "" : `<g mask="url(#${id}-cut)">${under.map(draw).join("")}</g>`) +
    over.map(draw).join("") +
    `</svg>`
  );
}
