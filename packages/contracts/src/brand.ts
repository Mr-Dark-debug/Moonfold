/**
 * Cassandre brand kits: the files an agent builds in `<project>/.moonfold/brand/`, and what the
 * server reports about them. Agents write the creative source (tokens, SVGs, Markdown); the
 * server validates it and generates every export from it.
 */
import * as Schema from "effect/Schema";

import { NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";

/** The steps a kit moves through, in order. */
export const BRAND_STEPS = [
  "brief",
  "plan",
  "name",
  "references",
  "directions",
  "system",
  "review",
  "handover",
] as const;

export const BrandStepName = Schema.Literals(BRAND_STEPS);
export type BrandStepName = typeof BrandStepName.Type;

export const BrandStepStatus = Schema.Literals(["pending", "in_progress", "done", "skipped"]);
export type BrandStepStatus = typeof BrandStepStatus.Type;

export const BrandStepNote = Schema.String.check(Schema.isMaxLength(2_000));

export const BrandStep = Schema.Struct({
  status: BrandStepStatus,
  note: Schema.optional(BrandStepNote),
  updatedAt: Schema.String,
});
export type BrandStep = typeof BrandStep.Type;

export const BrandPrompt = TrimmedNonEmptyString.check(Schema.isMaxLength(4_000));

/** `brand.json`: the kit's prompt and the status of each step, so a kit can be resumed. */
export const BrandManifest = Schema.Struct({
  version: Schema.Literal(1),
  prompt: BrandPrompt,
  createdAt: Schema.String,
  updatedAt: Schema.String,
  steps: Schema.Struct({
    brief: BrandStep,
    plan: BrandStep,
    name: BrandStep,
    references: BrandStep,
    directions: BrandStep,
    system: BrandStep,
    review: BrandStep,
    handover: BrandStep,
  }),
});
export type BrandManifest = typeof BrandManifest.Type;

export const BrandInitResult = Schema.Struct({
  manifest: BrandManifest,
  /** The kit was already there; its manifest was left as it was. */
  existed: Schema.Boolean,
  /** The project's `.gitignore` was changed to keep `references/` private. */
  gitignoreUpdated: Schema.Boolean,
});
export type BrandInitResult = typeof BrandInitResult.Type;

export const BrandFileEntry = Schema.Struct({
  /** Relative to the brand folder, with `/` separators. */
  path: Schema.String,
  sizeBytes: NonNegativeInt,
});
export type BrandFileEntry = typeof BrandFileEntry.Type;

export const BrandArea = Schema.Struct({
  /** A top-level folder of the kit, or `.` for the files beside `brand.json`. */
  area: Schema.String,
  files: Schema.Array(BrandFileEntry),
});
export type BrandArea = typeof BrandArea.Type;

export const BrandStatus = Schema.Struct({
  manifest: BrandManifest,
  areas: Schema.Array(BrandArea),
  /** More files exist than were listed. */
  truncated: Schema.Boolean,
});
export type BrandStatus = typeof BrandStatus.Type;

export const BrandStepInput = Schema.Struct({
  step: BrandStepName,
  status: BrandStepStatus,
  note: Schema.optional(BrandStepNote),
});
export type BrandStepInput = typeof BrandStepInput.Type;

const MAX_BRAND_NAME_CHECKS = 10;

export const BrandNameCandidate = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

export const BrandNameCheckInput = Schema.Struct({
  names: Schema.Array(BrandNameCandidate).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_BRAND_NAME_CHECKS),
  ),
});
export type BrandNameCheckInput = typeof BrandNameCheckInput.Type;

/** `available` and `taken` come from the registry's own answer; anything else is `unknown`. */
export const BrandAvailability = Schema.Literals(["available", "taken", "unknown"]);
export type BrandAvailability = typeof BrandAvailability.Type;

export const BrandNameCheck = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  domains: Schema.Struct({
    com: BrandAvailability,
    dev: BrandAvailability,
    app: BrandAvailability,
  }),
  github: BrandAvailability,
  npm: BrandAvailability,
  trademarkSearchUrl: Schema.String,
});
export type BrandNameCheck = typeof BrandNameCheck.Type;

export const BrandNameCheckResult = Schema.Struct({
  checks: Schema.Array(BrandNameCheck),
  note: Schema.String,
});
export type BrandNameCheckResult = typeof BrandNameCheckResult.Type;

const ShortText = (max: number) => TrimmedNonEmptyString.check(Schema.isMaxLength(max));

export const BrandReferenceInput = Schema.Struct({
  url: ShortText(2_048).check(Schema.isPattern(/^https?:\/\//i)),
  title: ShortText(300),
  why: ShortText(1_000),
  site: Schema.optional(ShortText(200)),
  author: Schema.optional(ShortText(200)),
  /** Absolute path of a PNG to keep beside the reference, such as a saved preview snapshot. */
  screenshotPath: Schema.optional(ShortText(4_096)),
});
export type BrandReferenceInput = typeof BrandReferenceInput.Type;

/** One entry of `references/index.json`. */
export const BrandReference = Schema.Struct({
  id: Schema.String,
  url: Schema.String,
  title: Schema.String,
  why: Schema.String,
  site: Schema.NullOr(Schema.String),
  author: Schema.NullOr(Schema.String),
  keptAt: Schema.String,
  /** Relative to the brand folder. */
  shot: Schema.optional(Schema.String),
});
export type BrandReference = typeof BrandReference.Type;

export const BrandReferenceIndex = Schema.Array(BrandReference);

export const BrandRelativePath = ShortText(512);

export const BrandRenderInput = Schema.Struct({
  html: BrandRelativePath,
  png: BrandRelativePath,
  width: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 240, maximum: 1_600 }))),
  appearance: Schema.optional(Schema.Literals(["dark", "light"])),
});
export type BrandRenderInput = typeof BrandRenderInput.Type;

export const BrandRenderResult = Schema.Struct({
  path: Schema.String,
  width: NonNegativeInt,
  height: NonNegativeInt,
  /** Local images the page names that could not be read. */
  missingImages: Schema.optional(Schema.Array(Schema.String)),
});
export type BrandRenderResult = typeof BrandRenderResult.Type;

export const BrandIssue = Schema.Struct({
  /** The file the issue is in, relative to the brand folder. */
  path: Schema.String,
  message: Schema.String,
});
export type BrandIssue = typeof BrandIssue.Type;

export const BrandContrastCheck = Schema.Struct({
  theme: Schema.Literals(["light", "dark"]),
  foreground: Schema.String,
  background: Schema.String,
  ratio: Schema.Number,
  minimum: Schema.Number,
  /** Below the minimum this is an error, or a warning for decorative pairs such as borders. */
  level: Schema.Literals(["error", "warning"]),
  passes: Schema.Boolean,
});
export type BrandContrastCheck = typeof BrandContrastCheck.Type;

export const BrandValidationReport = Schema.Struct({
  ok: Schema.Boolean,
  errors: Schema.Array(BrandIssue),
  warnings: Schema.Array(BrandIssue),
  contrast: Schema.Array(BrandContrastCheck),
});
export type BrandValidationReport = typeof BrandValidationReport.Type;

export const BrandExportResult = Schema.Struct({
  /** Relative to the brand folder, in the order they were written. */
  files: Schema.Array(Schema.String),
});
export type BrandExportResult = typeof BrandExportResult.Type;

/** At most this many reviewers sit on one panel, one council glyph each (D-67). */
const MAX_BRAND_REVIEWERS = 6;

export const BrandReviewScore = Schema.Struct({
  /** Who reviewed, as shown to the user: provider and model, never a logo. */
  reviewer: ShortText(80),
  score: Schema.Number.check(Schema.isBetween({ minimum: 0, maximum: 10 })),
  fixes: Schema.Array(ShortText(400)).check(Schema.isMaxLength(12)),
});
export type BrandReviewScore = typeof BrandReviewScore.Type;

export const BrandReviewRoundInput = Schema.Struct({
  round: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 20 })),
  scores: Schema.Array(BrandReviewScore).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(MAX_BRAND_REVIEWERS),
  ),
});
export type BrandReviewRoundInput = typeof BrandReviewRoundInput.Type;

export const BrandReviewSeat = Schema.Struct({
  /** 1-based; the same reviewer keeps the same seat across rounds. */
  seat: Schema.Int,
  reviewer: Schema.String,
});
export type BrandReviewSeat = typeof BrandReviewSeat.Type;

export const BrandReviewRoundResult = Schema.Struct({
  round: Schema.Int,
  average: Schema.Number,
  /** The change from the previous round's average, or null for the first round. */
  change: Schema.NullOr(Schema.Number),
  seats: Schema.Array(BrandReviewSeat),
  /** The review summary the user reads, relative to the brand folder. */
  file: Schema.String,
});
export type BrandReviewRoundResult = typeof BrandReviewRoundResult.Type;
