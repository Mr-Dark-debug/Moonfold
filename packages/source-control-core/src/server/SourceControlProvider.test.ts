import { assert, it } from "@effect/vitest";

import {
  repositoryPathFromRemoteUrl,
  transportSafeSourceControlErrorValue,
} from "./SourceControlProvider.ts";

it("removes URL credentials, query parameters, and fragments from error transport values", () => {
  assert.strictEqual(
    transportSafeSourceControlErrorValue(
      "https://user:secret@example.test/org/repo/pull/42?token=secret#discussion",
    ),
    "https://example.test/org/repo/pull/42",
  );
});

it.each([
  ["git@github.com:Moonfold/moonfold.git", "Moonfold/moonfold"],
  ["github.com:Moonfold/moonfold.git", "Moonfold/moonfold"],
  ["gitlab.com:Moonfold/platform/moonfold", "Moonfold/platform/moonfold"],
  ["https://github.com/Moonfold/moonfold.git", "Moonfold/moonfold"],
  ["C:/repos/moonfold", null],
])("reads the repository path of %s", (remoteUrl, expected) => {
  assert.strictEqual(repositoryPathFromRemoteUrl(remoteUrl), expected);
});
