import { assert, describe, it } from "@effect/vitest";
import { ProjectId, ProviderInstanceId, ThreadId, TextGenerationError } from "@moonfold/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ProjectService from "../project/ProjectService.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ThreadSideQuestions from "./ThreadSideQuestions.ts";

const threadId = ThreadId.make("thread-1");
const modelSelection = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

describe("sideQuestionConversation", () => {
  it("keeps the newest messages that fit, oldest first, labelled by speaker", () => {
    const conversation = ThreadSideQuestions.sideQuestionConversation(
      [
        { role: "user", text: "first question that will not fit" },
        { role: "system", text: "hidden" },
        { role: "user", text: "Rename the helper" },
        { role: "assistant", text: "Renamed it to parseInput." },
      ],
      60,
    );
    assert.equal(conversation, "User:\nRename the helper\n\nAgent:\nRenamed it to parseInput.");
  });
});

function testLayer(input: {
  readonly worktreePath: string | null;
  readonly calls: Array<TextGeneration.SideQuestionInput>;
  readonly fail?: boolean;
}) {
  return ThreadSideQuestions.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadRecords: () =>
            Effect.succeed({
              thread: {
                id: threadId,
                projectId: ProjectId.make("project-1"),
                worktreePath: input.worktreePath,
                modelSelection,
              },
              messages: [
                { role: "user", text: "Fix the flaky test" },
                { role: "assistant", text: "The test now waits for the server." },
              ],
            } as never),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: () => Effect.succeedSome({ workspaceRoot: "/work/app" } as never),
        }),
        Layer.mock(TextGeneration.TextGeneration)({
          answerSideQuestion: (request) => {
            input.calls.push(request);
            return input.fail
              ? Effect.fail(
                  new TextGenerationError({
                    operation: "answerSideQuestion",
                    detail: "Codex is busy.",
                  }),
                )
              : Effect.succeed({ answer: "It waits for the ready signal." });
          },
        }),
      ),
    ),
  );
}

describe("ThreadSideQuestions", () => {
  it.effect("asks the thread's own model about its conversation, in its checkout", () => {
    const calls: Array<TextGeneration.SideQuestionInput> = [];
    return Effect.gen(function* () {
      const sideQuestions = yield* ThreadSideQuestions.ThreadSideQuestions;
      const result = yield* sideQuestions.ask({ threadId, question: "What did the fix change?" });
      assert.deepEqual(result, { answer: "It waits for the ready signal." });
      assert.equal(calls.length, 1);
      assert.deepEqual(calls[0]?.modelSelection, modelSelection);
      assert.equal(calls[0]?.cwd, "/work/worktree");
      assert.equal(calls[0]?.question, "What did the fix change?");
      assert.include(calls[0]?.conversation ?? "", "Agent:\nThe test now waits for the server.");
    }).pipe(Effect.provide(testLayer({ worktreePath: "/work/worktree", calls })));
  });

  it.effect("uses the project folder without a worktree and reports model failures", () => {
    const calls: Array<TextGeneration.SideQuestionInput> = [];
    return Effect.gen(function* () {
      const sideQuestions = yield* ThreadSideQuestions.ThreadSideQuestions;
      const error = yield* Effect.flip(sideQuestions.ask({ threadId, question: "Why?" }));
      assert.equal(calls[0]?.cwd, "/work/app");
      assert.include(error.detail, "Codex is busy.");
    }).pipe(Effect.provide(testLayer({ worktreePath: null, calls, fail: true })));
  });
});
