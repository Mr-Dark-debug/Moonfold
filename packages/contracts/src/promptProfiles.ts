/**
 * Prompt profiles: named standing instructions Moonfold sends with every turn (D-54).
 *
 * The environment or a project picks a default; a thread can override it. Profiles add to a
 * provider's system prompt through the channel adapters already use for Moonfold's own
 * instructions. They never replace it and never edit AGENTS.md or CLAUDE.md.
 */
import * as Schema from "effect/Schema";

import { BRAND_KIT_INSTRUCTIONS } from "./brandKitProfile.ts";

export const PromptProfileId = Schema.String.check(
  Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,63}$/),
).pipe(Schema.brand("PromptProfileId"));
export type PromptProfileId = typeof PromptProfileId.Type;

/** Longest instructions text a profile may carry, in characters. */
export const PROMPT_PROFILE_MAX_INSTRUCTIONS = 16_000;
/** Most custom profiles one environment keeps. */
export const PROMPT_PROFILE_MAX_CUSTOM = 50;

export const PromptProfile = Schema.Struct({
  id: PromptProfileId,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
  description: Schema.String.check(Schema.isMaxLength(240)),
  instructions: Schema.String.check(Schema.isMaxLength(PROMPT_PROFILE_MAX_INSTRUCTIONS)),
});
export type PromptProfile = typeof PromptProfile.Type;

export const CustomPromptProfiles = Schema.Array(PromptProfile).check(
  Schema.isMaxLength(PROMPT_PROFILE_MAX_CUSTOM),
);

export const DEFAULT_PROMPT_PROFILE_ID = PromptProfileId.make("moonfold-default");
export const BRAND_KIT_PROMPT_PROFILE_ID = PromptProfileId.make("cassandre");

const builtIn = (profile: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
}): PromptProfile => ({ ...profile, id: PromptProfileId.make(profile.id) });

export const BUILT_IN_PROMPT_PROFILES: ReadonlyArray<PromptProfile> = [
  builtIn({
    id: DEFAULT_PROMPT_PROFILE_ID,
    name: "Moonfold default",
    description: "Adds nothing. Each agent works the way its own harness tells it to.",
    instructions: "",
  }),
  builtIn({
    id: "careful-engineer",
    name: "Careful engineer",
    description: "Small, reviewable changes; checks its work before saying it is done.",
    instructions: [
      "Work in small, reviewable steps and keep each change focused on the request.",
      "Before editing, read the code you are about to change and the code that calls it.",
      "Prefer the project's existing patterns, helpers and naming over new ones.",
      "After a change, run the narrowest tests, type checks or linters that cover it, and report the real result. If you could not run something, say so.",
      "Do not claim success you have not verified, and do not hide failing output.",
      "Ask before destructive or hard-to-reverse actions such as deleting data, force-pushing or rewriting history.",
    ].join("\n"),
  }),
  builtIn({
    id: "terminal-first",
    name: "Terminal-first",
    description:
      "Shell-driven: inspects with commands, edits with patches, verifies by running things.",
    instructions: [
      "Treat the terminal as your main tool: inspect the repository with search and listing commands before reading whole files.",
      "Make edits as minimal patches to existing files rather than rewriting them.",
      "Respect the sandbox and permission mode you are given. If a command is blocked, explain what you need and why instead of working around it.",
      "Verify changes by running the relevant command and reading its output; quote the decisive lines.",
      "Keep final messages short: what changed, where, and how it was checked.",
    ].join("\n"),
  }),
  builtIn({
    id: "pair-programmer",
    name: "Pair programmer",
    description: "Explains its reasoning and the trade-offs, and checks in before large moves.",
    instructions: [
      "Work as a pair programmer: explain what you are about to do and why before larger changes.",
      "When there is more than one reasonable approach, name the options and the trade-off, then recommend one.",
      "Point out risks, edge cases and missing tests you notice, even outside the immediate request.",
      "Keep explanations concrete and tied to file paths and line numbers.",
    ].join("\n"),
  }),
  builtIn({
    id: "minimal",
    name: "Minimal",
    description: "Short answers and only the changes asked for.",
    instructions: [
      "Be brief. Answer in as few words as the question allows.",
      "Change only what was asked; do not refactor, rename or reformat anything else.",
      "Skip summaries and recaps unless asked.",
    ].join("\n"),
  }),
  builtIn({
    id: BRAND_KIT_PROMPT_PROFILE_ID,
    name: "Cassandre (brand kit)",
    description: "Builds a brand kit from a prompt. Start a message with /brand to use it.",
    instructions: BRAND_KIT_INSTRUCTIONS,
  }),
];

/** Built-ins first, then the user's profiles; a custom profile cannot shadow a built-in id. */
export function listPromptProfiles(
  customProfiles: ReadonlyArray<PromptProfile>,
): ReadonlyArray<PromptProfile & { readonly builtIn: boolean }> {
  const builtInIds = new Set<string>(BUILT_IN_PROMPT_PROFILES.map((profile) => profile.id));
  return [
    ...BUILT_IN_PROMPT_PROFILES.map((profile) => ({ ...profile, builtIn: true })),
    ...customProfiles
      .filter((profile) => !builtInIds.has(profile.id))
      .map((profile) => ({ ...profile, builtIn: false })),
  ];
}

/**
 * The profile a turn uses: the thread's override, else the (project-resolved) default. An id that
 * no longer exists falls back to Moonfold default, so deleting a profile never breaks a thread.
 */
export function resolvePromptProfile(input: {
  readonly customProfiles: ReadonlyArray<PromptProfile>;
  readonly defaultProfileId: string;
  readonly threadProfileId?: string | null | undefined;
}): PromptProfile {
  const profiles = listPromptProfiles(input.customProfiles);
  const wanted = input.threadProfileId ?? input.defaultProfileId;
  const found =
    profiles.find((profile) => profile.id === wanted) ??
    profiles.find((profile) => profile.id === input.defaultProfileId) ??
    BUILT_IN_PROMPT_PROFILES[0]!;
  const { builtIn: _builtIn, ...profile } = found as PromptProfile & { builtIn?: boolean };
  return profile;
}
