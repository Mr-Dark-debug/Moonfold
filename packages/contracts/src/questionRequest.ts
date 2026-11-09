import * as Schema from "effect/Schema";

import { ThreadId, TrimmedNonEmptyString, TurnItemId } from "./baseSchemas.ts";

const QUESTION_REQUEST_MAX_IMAGES = 4;

export const QuestionRequestOption = Schema.Struct({
  label: TrimmedNonEmptyString.check(Schema.isMaxLength(120)).annotate({
    description: "Unique within the question.",
  }),
  description: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  /** Returned beside the label, for a choice the label only names. */
  value: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  images: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(QUESTION_REQUEST_MAX_IMAGES)),
  ).annotate({ description: "Absolute paths of images in this thread's workspace." }),
});
export type QuestionRequestOption = typeof QuestionRequestOption.Type;

export const QuestionRequestQuestion = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  header: TrimmedNonEmptyString.check(Schema.isMaxLength(60)),
  question: TrimmedNonEmptyString.check(Schema.isMaxLength(1_000)),
  multiSelect: Schema.optional(Schema.Boolean),
  allowCustomAnswer: Schema.optional(Schema.Boolean).annotate({
    description: "Adds an Other text field.",
  }),
  options: Schema.Array(QuestionRequestOption).check(Schema.isMinLength(2), Schema.isMaxLength(6)),
});
export type QuestionRequestQuestion = typeof QuestionRequestQuestion.Type;

export const QuestionRequestQuestions = Schema.Array(QuestionRequestQuestion).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4),
);

export const QuestionRequestStatus = Schema.Literals(["pending", "answered", "cancelled"]);
export type QuestionRequestStatus = typeof QuestionRequestStatus.Type;

/** `selected` holds option labels. */
export const QuestionRequestAnswer = Schema.Struct({
  selected: Schema.Array(Schema.String).check(Schema.isMaxLength(6)),
  custom: Schema.optional(Schema.String.check(Schema.isMaxLength(2_000))),
});
export type QuestionRequestAnswer = typeof QuestionRequestAnswer.Type;

/** Keyed by question id. */
export const QuestionRequestAnswers = Schema.Record(Schema.String, QuestionRequestAnswer);
export type QuestionRequestAnswers = typeof QuestionRequestAnswers.Type;

export const QuestionRequestAnswerInput = Schema.Struct({
  threadId: ThreadId,
  turnItemId: TurnItemId,
  answer: Schema.Union([
    Schema.Struct({ type: Schema.Literal("submit"), answers: QuestionRequestAnswers }),
    Schema.Struct({ type: Schema.Literal("dismiss") }),
  ]),
});
export type QuestionRequestAnswerInput = typeof QuestionRequestAnswerInput.Type;

/** Why `questions` cannot be asked, or null: ids and option labels must be unique. */
export function questionRequestProblem(
  questions: ReadonlyArray<QuestionRequestQuestion>,
): string | null {
  const ids = new Set<string>();
  for (const question of questions) {
    if (ids.has(question.id)) return `Question id "${question.id}" is used twice.`;
    ids.add(question.id);
    const labels = new Set<string>();
    for (const option of question.options) {
      if (labels.has(option.label)) {
        return `Question "${question.id}" has two options labelled "${option.label}".`;
      }
      labels.add(option.label);
    }
  }
  return null;
}

/**
 * Drops blank custom text, so `{ custom: " " }` counts as no answer. Every
 * consumer compares answers in this form.
 */
export function normalizeQuestionRequestAnswers(
  answers: QuestionRequestAnswers,
): QuestionRequestAnswers {
  return Object.fromEntries(
    Object.entries(answers).map(([id, answer]) => {
      const custom = answer.custom?.trim();
      return [
        id,
        custom ? { selected: answer.selected, custom } : { selected: answer.selected },
      ] as const;
    }),
  );
}

/**
 * Why `answers` does not answer every question, or null. Each question needs a
 * choice or custom text; a single-select question takes one of them.
 */
export function questionRequestAnswerProblem(
  questions: ReadonlyArray<QuestionRequestQuestion>,
  answers: QuestionRequestAnswers,
): string | null {
  const known = new Set(questions.map((question) => question.id));
  const unknown = Object.keys(answers).find((id) => !known.has(id));
  if (unknown !== undefined) return `There is no question "${unknown}".`;
  for (const question of questions) {
    const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
    const selected = answer?.selected ?? [];
    const custom = answer?.custom?.trim() ?? "";
    if (selected.length === 0 && custom === "") return `Answer "${question.header}".`;
    if (new Set(selected).size !== selected.length) {
      return `"${question.header}" has the same choice twice.`;
    }
    const labels = new Set(question.options.map((option) => option.label));
    const stray = selected.find((label) => !labels.has(label));
    if (stray !== undefined) return `"${stray}" is not a choice for "${question.header}".`;
    if (custom !== "" && question.allowCustomAnswer !== true) {
      return `"${question.header}" takes only the listed choices.`;
    }
    if (question.multiSelect !== true && selected.length + (custom === "" ? 0 : 1) > 1) {
      return `"${question.header}" takes one choice.`;
    }
  }
  return null;
}

const QUESTION_REQUEST_FAILURE_MESSAGES = {
  load_failed: "Could not load the question.",
  not_found: "This question no longer exists.",
  already_answered: "This question was already answered.",
  agent_stopped: "The agent that asked has stopped, so this answer can't be used.",
  invalid_answer: "That answer does not fit the question.",
  record_failed: "Could not save the answer. Try again.",
} as const;

export const QuestionRequestFailureReason = Schema.Literals(
  Object.keys(QUESTION_REQUEST_FAILURE_MESSAGES) as Array<
    keyof typeof QUESTION_REQUEST_FAILURE_MESSAGES
  >,
);
export type QuestionRequestFailureReason = typeof QuestionRequestFailureReason.Type;

export class QuestionRequestError extends Schema.TaggedError<QuestionRequestError>()(
  "QuestionRequestError",
  {
    reason: QuestionRequestFailureReason,
    /** What an `invalid_answer` got wrong, built from the question's own text. */
    problem: Schema.optionalKey(Schema.String),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.reason === "invalid_answer" && this.problem !== undefined
      ? this.problem
      : QUESTION_REQUEST_FAILURE_MESSAGES[this.reason];
  }
}
