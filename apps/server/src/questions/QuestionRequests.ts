// The user's side of a question card an agent opened with `moonfold_ask_user`. The agent's call
// waits in its run and reads the answer from the card.
import {
  CommandId,
  normalizeQuestionRequestAnswers,
  questionRequestAnswerProblem,
  QuestionRequestError,
  type QuestionRequestAnswerInput,
} from "@moonfold/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";

export class QuestionRequests extends Context.Service<
  QuestionRequests,
  {
    /** Submits or dismisses a pending card. */
    readonly answer: (
      input: QuestionRequestAnswerInput,
    ) => Effect.Effect<void, QuestionRequestError>;
  }
>()("moonfold/questions/QuestionRequests") {}

const make = Effect.gen(function* () {
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;

  const answer: QuestionRequests["Service"]["answer"] = Effect.fn("QuestionRequests.answer")(
    function* (input) {
      yield* Effect.annotateCurrentSpan({
        "orchestration_v2.thread_id": input.threadId,
        "question_request.answer": input.answer.type,
      });
      const records = yield* threadManagement
        .getThreadRecords(input.threadId, ["runs", "turnItems"], {
          turnItemTypes: ["question_request"],
          messageRoles: [],
        })
        .pipe(
          Effect.mapError((cause) => new QuestionRequestError({ reason: "load_failed", cause })),
        );
      const item = records.turnItems.find((candidate) => candidate.id === input.turnItemId);
      if (item?.type !== "question_request" || item.runId === null || item.nodeId === null) {
        return yield* new QuestionRequestError({ reason: "not_found" });
      }
      if (item.questionStatus !== "pending") {
        return yield* new QuestionRequestError({ reason: "already_answered" });
      }
      const run = records.runs.find((candidate) => candidate.id === item.runId);
      if (run === undefined || ThreadManagementService.isTerminalRunStatus(run.status)) {
        return yield* new QuestionRequestError({ reason: "agent_stopped" });
      }
      const answers =
        input.answer.type === "submit"
          ? normalizeQuestionRequestAnswers(input.answer.answers)
          : undefined;
      if (answers !== undefined) {
        const problem = questionRequestAnswerProblem(item.questions, answers);
        if (problem !== null) {
          return yield* new QuestionRequestError({ reason: "invalid_answer", problem });
        }
      }
      const questionStatus = answers === undefined ? "cancelled" : "answered";
      yield* threadManagement
        .dispatch({
          type: "question_request.record",
          commandId: CommandId.make(`question-request:${item.id}:${questionStatus}`),
          threadId: input.threadId,
          runId: item.runId,
          nodeId: item.nodeId,
          turnItemId: item.id,
          ...(item.title === null ? {} : { title: item.title }),
          questions: item.questions,
          questionStatus,
          ...(answers === undefined ? {} : { answers }),
        })
        .pipe(
          Effect.mapError((cause) => new QuestionRequestError({ reason: "record_failed", cause })),
        );
      if (answers === undefined) return;
      // The run may have closed the card first; then nobody reads this answer.
      const recorded = yield* threadManagement
        .getThreadRecords(input.threadId, ["turnItems"], {
          turnItemTypes: ["question_request"],
          messageRoles: [],
        })
        .pipe(
          Effect.mapError((cause) => new QuestionRequestError({ reason: "record_failed", cause })),
        );
      const card = recorded.turnItems.find((candidate) => candidate.id === item.id);
      if (card?.type === "question_request" && card.questionStatus !== "answered") {
        return yield* new QuestionRequestError({ reason: "agent_stopped" });
      }
    },
  );

  return QuestionRequests.of({ answer });
});

export const layer = Layer.effect(QuestionRequests, make);
