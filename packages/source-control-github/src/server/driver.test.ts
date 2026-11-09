import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { makeIsRepositoryStarred, makeStarRepository } from "./driver.ts";
import * as GitHubRequestPolicy from "./GitHubRequestPolicy.ts";
import * as GitHubRest from "./GitHubRest.ts";

describe("starred", () => {
  it.effect("checks and stars only a valid repository, true only on 204", () => {
    const paths: Array<string> = [];
    const starred = new Set(["user/starred/moonfold-dev/moonfold"]);
    const api = Layer.mock(GitHubRest.GitHubRest)({
      rest: (input) => {
        paths.push(`${input.method ?? "GET"} ${input.path}`);
        return starred.has(input.path)
          ? Effect.succeed({
              status: 204,
              headers: {},
              body: "",
              truncated: false,
              invalidUtf8: false,
            })
          : Effect.fail(
              new GitHubRequestPolicy.GitHubApiNotFoundError({
                host: input.host,
                operation: input.operation,
              }),
            );
      },
    });
    return Effect.gen(function* () {
      const isStarred = yield* makeIsRepositoryStarred;
      const star = yield* makeStarRepository;
      assert.isTrue(yield* isStarred("github.com", "moonfold-dev/moonfold"));
      assert.isFalse(yield* isStarred("github.com", "moonfold-dev/uploadthing"));
      assert.isFalse(yield* isStarred("github.com", "moonfold-dev/moonfold/../../user"));
      assert.isFalse(yield* isStarred("github.com", "../repos"));
      assert.isTrue(yield* star("github.com", "moonfold-dev/moonfold"));
      assert.isFalse(yield* star("github.com", "moonfold-dev/uploadthing"));
      assert.isFalse(yield* star("github.com", "moonfold-dev/moonfold/../../user"));
      assert.isFalse(yield* star("github.com", "../repos"));
      assert.deepStrictEqual(paths, [
        "GET user/starred/moonfold-dev/moonfold",
        "GET user/starred/moonfold-dev/uploadthing",
        "PUT user/starred/moonfold-dev/moonfold",
        "PUT user/starred/moonfold-dev/uploadthing",
      ]);
    }).pipe(Effect.provide(api));
  });
});
