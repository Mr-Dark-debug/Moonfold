import { describe, expect, it } from "@effect/vitest";

import { isBrandKitCommand } from "./brandKitProfile.ts";
import {
  BRAND_KIT_PROMPT_PROFILE_ID,
  PROMPT_PROFILE_MAX_INSTRUCTIONS,
  resolvePromptProfile,
} from "./promptProfiles.ts";

describe("Cassandre brand kit profile", () => {
  it("recognizes /brand only at the start of a message", () => {
    expect(isBrandKitCommand("/brand a calm budgeting app")).toBe(true);
    expect(isBrandKitCommand("  /Brand\nfor students")).toBe(true);
    expect(isBrandKitCommand("/brand")).toBe(true);
    expect(isBrandKitCommand("/branding ideas")).toBe(false);
    expect(isBrandKitCommand("make a /brand kit")).toBe(false);
  });

  it("is a built-in profile a thread can resolve, within the instructions limit", () => {
    const profile = resolvePromptProfile({
      customProfiles: [],
      defaultProfileId: "moonfold-default",
      threadProfileId: BRAND_KIT_PROMPT_PROFILE_ID,
    });
    expect(profile.id).toBe(BRAND_KIT_PROMPT_PROFILE_ID);
    expect(profile.instructions).toContain("moonfold_ask_user");
    expect(profile.instructions.length).toBeLessThanOrEqual(PROMPT_PROFILE_MAX_INSTRUCTIONS);
  });
});
