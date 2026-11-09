import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentIdentificationMode } from "@moonfold/contracts";
import { useId } from "react";

import { APP_STAGE_LABEL } from "../branding";
import { resolveServerBackedAppStageLabel } from "../branding.logic";
import { primaryServerConfigAtom } from "../state/server";

export type SidebarStageBackdropVariant = "nightly" | "dev";
export type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

const STAGE_BACKDROP_VIEW_BOX = "0 0 8192 96";

export function resolveSidebarStageBackdropVariant(
  stageLabel: string,
  mode: EnvironmentIdentificationMode = "artwork",
): SidebarStageBackdropVariant | null {
  if (mode === "nightly-artwork") return "nightly";
  if (mode === "dev-artwork") return "dev";
  if (mode !== "artwork") return null;
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "nightly") return "nightly";
  if (normalized === "dev") return "dev";
  return null;
}

export function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentStageLabel(): string {
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;

  return resolveServerBackedAppStageLabel({
    primaryServerVersion,
    fallbackStageLabel: APP_STAGE_LABEL,
  });
}

export function useSidebarStageBackdropVariant(
  mode: EnvironmentIdentificationMode,
): SidebarStageBackdropVariant | null {
  return resolveSidebarStageBackdropVariant(useEnvironmentStageLabel(), mode);
}

export function SidebarStageBackdrop({ variant }: { variant: SidebarStageBackdropVariant }) {
  return (
    <div
      aria-hidden
      className="sidebar-stage-backdrop pointer-events-none absolute inset-x-0 top-0 z-0 h-20 select-none overflow-hidden"
    >
      <StageBackdropArt variant={variant} />
    </div>
  );
}

function StageBackdropArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return variant === "nightly" ? <NightlySkyArt /> : <DevBlueprintArt />;
}

export function StageBackdropButtonArt({ variant }: { variant: SidebarStageBackdropVariant }) {
  return variant === "nightly" ? <NightlySkyArt compact /> : <DevBlueprintArt compact />;
}

// Deterministic star field for the Nightly sky; positions repeat every 300 units.
const NIGHTLY_STARS: ReadonlyArray<{ cx: number; cy: number; r: number; opacity: number }> = [
  { cx: 14, cy: 10, r: 0.6, opacity: 0.85 },
  { cx: 41, cy: 27, r: 0.4, opacity: 0.5 },
  { cx: 63, cy: 9, r: 0.5, opacity: 0.7 },
  { cx: 92, cy: 19, r: 0.4, opacity: 0.5 },
  { cx: 121, cy: 6, r: 0.6, opacity: 0.8 },
  { cx: 147, cy: 31, r: 0.4, opacity: 0.45 },
  { cx: 176, cy: 14, r: 0.5, opacity: 0.65 },
  { cx: 203, cy: 25, r: 0.4, opacity: 0.5 },
  { cx: 231, cy: 8, r: 0.6, opacity: 0.8 },
  { cx: 262, cy: 22, r: 0.45, opacity: 0.55 },
  { cx: 287, cy: 12, r: 0.5, opacity: 0.7 },
];

function NightlySkyArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const skyId = `${idPrefix}-stage-night-sky`;
  const starsId = `${idPrefix}-stage-night-stars`;

  return (
    <svg
      data-stage-art="nightly"
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "96 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={skyId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--stage-night-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-night-bottom)" }} />
        </linearGradient>
        <pattern id={starsId} width="300" height="96" patternUnits="userSpaceOnUse">
          {NIGHTLY_STARS.map((star) => (
            <circle
              key={`${star.cx}-${star.cy}`}
              cx={star.cx}
              cy={star.cy}
              r={star.r}
              style={{ fill: "var(--stage-night-sparkle)" }}
              opacity={star.opacity}
            />
          ))}
        </pattern>
      </defs>
      <rect width="8192" height="96" fill={`url(#${skyId})`} />
      <rect width="8192" height="96" fill={`url(#${starsId})`} />
    </svg>
  );
}

function DevBlueprintArt({ compact = false }: { compact?: boolean }) {
  const idPrefix = useId().replaceAll(":", "");
  const baseId = `${idPrefix}-stage-dev-base`;
  const gridId = `${idPrefix}-stage-dev-grid`;

  return (
    <svg
      data-stage-art="dev"
      className="h-full w-full"
      fill="none"
      preserveAspectRatio="xMinYMin slice"
      viewBox={compact ? "64 0 8192 96" : STAGE_BACKDROP_VIEW_BOX}
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={baseId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--stage-art-top)" }} />
          <stop offset="1" style={{ stopColor: "var(--stage-art-bottom)" }} />
        </linearGradient>
        <pattern id={gridId} width="16" height="16" patternUnits="userSpaceOnUse">
          <path
            d="M 16 0 L 0 0 0 16"
            style={{ stroke: "var(--stage-art-grid-line)" }}
            strokeOpacity="0.25"
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width="8192" height="96" fill={`url(#${baseId})`} />
      <rect width="8192" height="96" fill={`url(#${gridId})`} />
    </svg>
  );
}
