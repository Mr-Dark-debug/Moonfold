/**
 * ThreadSideQuestions - answers a quick question about a thread beside it. The thread's own
 * model reads the recent conversation through text generation (no tools), so nothing joins
 * the thread and a running turn is never interrupted.
 *
 * @module orchestration-v2/ThreadSideQuestions
 */
import {
  ThreadSideQuestionError,
  type OrchestrationV2ConversationMessage,
  type ThreadSideQuestionInput,
  type ThreadSideQuestionResult,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ProjectService from "../project/ProjectService.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import * as ProjectionStore from "./ProjectionStore.ts";

/** Recent conversation sent with a side question; older messages are left out. */
const CONVERSATION_CHAR_LIMIT = 60_000;

export class ThreadSideQuestions extends Context.Service<
  ThreadSideQuestions,
  {
    readonly ask: (
      input: ThreadSideQuestionInput,
    ) => Effect.Effect<ThreadSideQuestionResult, ThreadSideQuestionError>;
  }
>()("moonfold/orchestration-v2/ThreadSideQuestions") {}

/** The newest messages that fit the limit, oldest first, labelled by speaker. */
export function sideQuestionConversation(
  messages: ReadonlyArray<Pick<OrchestrationV2ConversationMessage, "role" | "text">>,
  limit: number = CONVERSATION_CHAR_LIMIT,
): string {
  const parts: Array<string> = [];
  let length = 0;
  for (const message of messages.toReversed()) {
    if (message.role === "system") continue;
    const text = message.text.trim();
    if (text.length === 0) continue;
    const part = `${message.role === "user" ? "User" : "Agent"}:\n${text}`;
    if (length + part.length > limit) {
      if (parts.length === 0) parts.push(`${part.slice(0, limit)}\n[shortened]`);
      break;
    }
    parts.push(part);
    length += part.length + 2;
  }
  return parts.toReversed().join("\n\n");
}

const make = Effect.gen(function* () {
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const projects = yield* ProjectService.ProjectService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const fail = (detail: string) => (cause: unknown) =>
    new ThreadSideQuestionError({ detail, cause });

  const ask: ThreadSideQuestions["Service"]["ask"] = Effect.fn("ThreadSideQuestions.ask")(
    function* (input) {
      const { thread, messages } = yield* projections
        .getThreadRecords(input.threadId, ["messages"])
        .pipe(Effect.mapError(fail("The thread could not be read.")));
      const project = yield* projects
        .getById(thread.projectId)
        .pipe(Effect.mapError(fail("The thread's project could not be read.")));
      const cwd =
        thread.worktreePath ??
        Option.match(project, { onNone: () => null, onSome: (entry) => entry.workspaceRoot });
      if (cwd === null) {
        return yield* new ThreadSideQuestionError({
          detail: "The thread's project is unavailable.",
        });
      }
      const conversation = sideQuestionConversation(messages);
      if (conversation.length === 0) {
        return yield* new ThreadSideQuestionError({
          detail: "The thread has no conversation to ask about yet.",
        });
      }
      const { answer } = yield* textGeneration
        .answerSideQuestion({
          cwd,
          conversation,
          question: input.question,
          modelSelection: thread.modelSelection,
        })
        .pipe(
          Effect.mapError(
            (error) => new ThreadSideQuestionError({ detail: error.message, cause: error }),
          ),
        );
      return { answer };
    },
    (effect, input) => effect.pipe(Effect.annotateSpans({ threadId: input.threadId })),
  );

  return ThreadSideQuestions.of({ ask });
});

export const layer = Layer.effect(ThreadSideQuestions, make);
