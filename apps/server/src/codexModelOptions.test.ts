import { assert, it } from "@effect/vitest";

import { ProviderInstanceId } from "@moonfold/contracts";
import { createModelSelection } from "@moonfold/shared/model";

import { getCodexServiceTierOptionValue } from "./codexModelOptions.ts";

it("keeps legacy persisted fast mode selections working", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
    { id: "fastMode", value: true },
  ]);

  assert.equal(getCodexServiceTierOptionValue(selection), "fast");
});
