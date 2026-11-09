import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  BUILT_IN_PROMPT_PROFILES,
  DEFAULT_PROMPT_PROFILE_ID,
  PromptProfile,
  PromptProfileId,
  listPromptProfiles,
  resolvePromptProfile,
} from "./promptProfiles.ts";
import { ServerSettings } from "./settings.ts";

const decodeServerSettings = Schema.decodeSync(ServerSettings);
const decodePromptProfileId = Schema.decodeSync(PromptProfileId);

const custom = (id: string, instructions = "Custom text"): PromptProfile => ({
  id: PromptProfileId.make(id),
  name: `Profile ${id}`,
  description: "",
  instructions,
});

describe("prompt profiles", () => {
  it("decodes settings without profiles to the Moonfold default", () => {
    const settings = decodeServerSettings({});
    expect(settings.promptProfiles).toEqual([]);
    expect(settings.defaultPromptProfileId).toBe(DEFAULT_PROMPT_PROFILE_ID);
  });

  it("keeps the Moonfold default empty so it adds nothing to a turn", () => {
    expect(BUILT_IN_PROMPT_PROFILES[0]?.id).toBe(DEFAULT_PROMPT_PROFILE_ID);
    expect(BUILT_IN_PROMPT_PROFILES[0]?.instructions).toBe("");
  });

  it("lists built-ins first and drops a custom profile that reuses a built-in id", () => {
    const listed = listPromptProfiles([custom("minimal"), custom("custom-one")]);
    expect(listed.filter((profile) => profile.id === "minimal")).toHaveLength(1);
    expect(listed.find((profile) => profile.id === "minimal")?.builtIn).toBe(true);
    expect(listed.at(-1)).toMatchObject({ id: "custom-one", builtIn: false });
  });

  it("prefers the thread's profile, then the default", () => {
    const customProfiles = [custom("custom-one", "One")];
    expect(
      resolvePromptProfile({
        customProfiles,
        defaultProfileId: "careful-engineer",
        threadProfileId: "custom-one",
      }).instructions,
    ).toBe("One");
    expect(resolvePromptProfile({ customProfiles, defaultProfileId: "careful-engineer" }).id).toBe(
      "careful-engineer",
    );
    expect(
      resolvePromptProfile({
        customProfiles,
        defaultProfileId: "careful-engineer",
        threadProfileId: null,
      }).id,
    ).toBe("careful-engineer");
  });

  it("falls back to the Moonfold default when a chosen profile was deleted", () => {
    const resolved = resolvePromptProfile({
      customProfiles: [],
      defaultProfileId: "custom-gone",
      threadProfileId: "custom-also-gone",
    });
    expect(resolved.id).toBe(DEFAULT_PROMPT_PROFILE_ID);
    expect("builtIn" in resolved).toBe(false);
  });

  it("rejects ids that are not lowercase slugs", () => {
    expect(() => decodePromptProfileId("Has Spaces")).toThrow();
  });
});
