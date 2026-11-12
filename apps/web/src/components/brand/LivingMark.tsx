/* oxlint-disable shadcn/no-raw-colors -- Mask luminance, not colours: white shows, black hides. */
import { useId, type CSSProperties } from "react";

import { cn } from "~/lib/utils";

import { LIVING_MARK as data } from "@moonfold/shared/livingMark";

export type LivingMarkState = "idle" | "working" | "waiting" | "done" | "attention";

const STATE_LABELS: Record<LivingMarkState, string> = {
  idle: "Moonfold",
  working: "Working",
  waiting: "Waiting for you",
  done: "Done",
  attention: "Needs attention",
};

/** At and below this size the ring is drawn heavier and the small details larger (BRAND.md). */
const SMALL_SIZE = 20;

/**
 * The Moonfold mark brought to life (docs/plans/mascot.md, D-67): the crescent, ring and star,
 * with one pose per state. Shapes come from `scripts/lib/brand-mark.ts` through the generated
 * JSON; motion is in `index.css` and is transforms and opacity only. Each state differs in shape,
 * so it reads with motion off.
 */
export function LivingMark({
  state = "idle",
  size = 20,
  twinkle = false,
  label,
  className,
}: {
  readonly state?: LivingMarkState;
  /** Width and height in CSS pixels. */
  readonly size?: number;
  /** Lets the idle star twinkle a few times. For places where the mark is the subject. */
  readonly twinkle?: boolean;
  /** Overrides the state's own accessible name; an empty string hides the mark from assistive tech. */
  readonly label?: string;
  readonly className?: string;
}) {
  const id = useId().replaceAll(":", "");
  const { box, moon, shadow, ring, star, orbit, waiting } = data;
  const small = size <= SMALL_SIZE;
  const ringWidth = small ? ring.widthSmall : ring.width;
  const tilted = `rotate(${ring.tilt} ${ring.cx} ${ring.cy})`;
  const name = label ?? STATE_LABELS[state];
  const style = {
    width: size,
    height: size,
    "--lm-cx": `${ring.cx}%`,
    "--lm-cy": `${ring.cy}%`,
    "--lm-rx": `${ring.rx}cqw`,
    "--lm-tilt": `${ring.tilt}deg`,
    "--lm-squash": ring.squash,
    "--lm-unsquash": 1 / ring.squash,
    "--lm-park": `${orbit.parked}deg`,
    "--lm-breathe-x": `${moon.cx}%`,
    "--lm-breathe-y": `${moon.cy}%`,
  } as CSSProperties;

  const pose = (kind: "base" | "alert") => {
    const turn = kind === "base" ? tilted : undefined;
    return (
      <g className={`lm-pose lm-pose-${kind}`} fill="currentColor" stroke="currentColor">
        <rect width={box} height={box} mask={`url(#${id}-crescent-${kind})`} stroke="none" />
        <g mask={`url(#${id}-back)`}>
          <path
            d={ring.back}
            transform={turn}
            fill="none"
            strokeWidth={ringWidth}
            strokeLinecap="round"
          />
        </g>
        <path
          d={ring.front}
          transform={turn}
          fill="none"
          strokeWidth={ringWidth}
          strokeLinecap="round"
        />
      </g>
    );
  };
  const crescentMask = (kind: "base" | "alert") => (
    <mask
      id={`${id}-crescent-${kind}`}
      maskUnits="userSpaceOnUse"
      x="0"
      y="0"
      width={box}
      height={box}
    >
      <circle cx={moon.cx} cy={moon.cy} r={moon.r} fill="#fff" />
      <circle cx={shadow.cx} cy={shadow.cy} r={shadow.r} fill="#000" />
      <path
        d={ring.front}
        transform={kind === "base" ? tilted : undefined}
        fill="none"
        stroke="#000"
        strokeWidth={ring.gap}
      />
    </mask>
  );

  return (
    <span
      className={cn("living-mark", className)}
      data-state={state}
      data-small={small ? "" : undefined}
      data-twinkle={twinkle ? "" : undefined}
      role={name === "" ? undefined : "img"}
      aria-label={name === "" ? undefined : name}
      aria-hidden={name === "" ? true : undefined}
      style={style}
    >
      <svg className="lm-body" viewBox={`0 0 ${box} ${box}`} aria-hidden="true">
        <defs>
          {crescentMask("base")}
          {crescentMask("alert")}
          <mask id={`${id}-back`} maskUnits="userSpaceOnUse" x="0" y="0" width={box} height={box}>
            <rect width={box} height={box} fill="#fff" />
            <circle cx={moon.cx} cy={moon.cy} r={ring.hideBehind} fill="#000" />
          </mask>
        </defs>
        {pose("base")}
        {pose("alert")}
        <g transform={`translate(${star.x} ${star.y})`}>
          <path className="lm-star" d={star.d} fill="currentColor" />
          <path
            className="lm-star-hollow"
            d={star.d}
            transform="scale(0.82)"
            fill="none"
            stroke="currentColor"
            strokeWidth={small ? 4.2 : 2.6}
            strokeLinejoin="round"
          />
          <path
            className="lm-rays"
            d={star.rays}
            fill="none"
            stroke="currentColor"
            strokeWidth={small ? 3.8 : 2.2}
            strokeLinecap="round"
          />
        </g>
        <g className="lm-waiting-dots" fill="currentColor">
          {waiting.map((dot) => (
            <circle key={dot.x} cx={dot.x} cy={dot.y} r={small ? dot.r * 1.6 : dot.r} />
          ))}
        </g>
        <path
          className="lm-still-star"
          d={star.traveller}
          transform={`translate(${orbit.still.x} ${orbit.still.y})`}
          fill="currentColor"
        />
      </svg>
      {state === "working" ? (
        <span className="lm-orbit" aria-hidden="true">
          <span className="lm-o lm-o-tilt">
            <span className="lm-o lm-o-squash">
              <span className="lm-o lm-o-lap">
                <span className="lm-o lm-o-out">
                  <span className="lm-o lm-o-unlap">
                    <span className="lm-o lm-o-unsquash">
                      <span className="lm-o lm-o-untilt">
                        <svg className="lm-traveller" viewBox="-10 -10 20 20">
                          <path d={star.traveller} />
                        </svg>
                      </span>
                    </span>
                  </span>
                </span>
              </span>
            </span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
