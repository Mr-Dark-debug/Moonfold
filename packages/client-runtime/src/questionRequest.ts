import {
  normalizeQuestionRequestAnswers,
  questionRequestAnswerProblem,
  type OrchestrationV2TurnItem,
  type QuestionRequestAnswerInput,
  type QuestionRequestAnswers,
  type QuestionRequestQuestion,
} from "@moonfold/contracts";

export type QuestionRequestItem = Extract<
  OrchestrationV2TurnItem,
  { readonly type: "question_request" }
>;

export type QuestionRequestDisplay =
  | { readonly kind: "pending" }
  | { readonly kind: "pending-elsewhere"; readonly label: string }
  | { readonly kind: "answered"; readonly label: string }
  | { readonly kind: "ended"; readonly label: string };

/**
 * `visibility` is the projected row's: a question inherited from another
 * thread (a fork) can only be answered where it was asked.
 */
export function questionRequestDisplay(
  item: Pick<QuestionRequestItem, "questionStatus" | "questions" | "answers">,
  visibility: "local" | "inherited" | "synthetic",
): QuestionRequestDisplay {
  switch (item.questionStatus) {
    case "pending":
      return visibility === "local"
        ? { kind: "pending" }
        : { kind: "pending-elsewhere", label: "Waiting for an answer in the original thread" };
    case "answered":
      return { kind: "answered", label: questionRequestAnswerSummary(item) };
    case "cancelled":
      return { kind: "ended", label: "Dismissed" };
  }
}

/** One line naming each choice, such as "Direction: Bold · Name: Harbor". */
export function questionRequestAnswerSummary(
  item: Pick<QuestionRequestItem, "questions" | "answers">,
): string {
  const answers = item.answers ?? {};
  return item.questions
    .map((question) => {
      const answer = Object.hasOwn(answers, question.id) ? answers[question.id] : undefined;
      const choices = [...(answer?.selected ?? []), ...(answer?.custom ? [answer.custom] : [])];
      const text = choices.length === 0 ? "No answer" : choices.join(", ");
      return item.questions.length === 1 ? text : `${question.header}: ${text}`;
    })
    .join(" · ");
}

/** The card's choices before Submit, by question id. */
export type QuestionRequestDraft = QuestionRequestAnswers;

/** Picks `label`; a single-select question swaps its choice and drops its Other text. */
export function toggleQuestionRequestChoice(
  draft: QuestionRequestDraft,
  question: Pick<QuestionRequestQuestion, "id" | "multiSelect">,
  label: string,
): QuestionRequestDraft {
  const current = Object.hasOwn(draft, question.id) ? draft[question.id] : undefined;
  const selected = current?.selected ?? [];
  if (question.multiSelect === true) {
    const next = selected.includes(label)
      ? selected.filter((candidate) => candidate !== label)
      : [...selected, label];
    return {
      ...draft,
      [question.id]:
        current?.custom === undefined ? { selected: next } : { ...current, selected: next },
    };
  }
  return {
    ...draft,
    [question.id]: { selected: selected.includes(label) ? [] : [label] },
  };
}

/** Sets the Other text; on a single-select question it replaces the picked choice. */
export function setQuestionRequestCustom(
  draft: QuestionRequestDraft,
  question: Pick<QuestionRequestQuestion, "id" | "multiSelect">,
  custom: string,
): QuestionRequestDraft {
  const current = Object.hasOwn(draft, question.id) ? draft[question.id] : undefined;
  const selected =
    question.multiSelect === true || custom.trim() === "" ? (current?.selected ?? []) : [];
  return { ...draft, [question.id]: { selected, custom } };
}

/** What still blocks Submit, or null. */
export function questionRequestDraftProblem(
  item: Pick<QuestionRequestItem, "questions">,
  draft: QuestionRequestDraft,
): string | null {
  return questionRequestAnswerProblem(item.questions, normalizeQuestionRequestAnswers(draft));
}

export function questionRequestAnswerInput(
  item: Pick<QuestionRequestItem, "id" | "threadId" | "questions">,
  reply:
    | { readonly type: "submit"; readonly draft: QuestionRequestDraft }
    | { readonly type: "dismiss" },
): QuestionRequestAnswerInput | null {
  if (reply.type === "dismiss") {
    return { threadId: item.threadId, turnItemId: item.id, answer: { type: "dismiss" } };
  }
  const answers = normalizeQuestionRequestAnswers(reply.draft);
  if (questionRequestAnswerProblem(item.questions, answers) !== null) return null;
  return { threadId: item.threadId, turnItemId: item.id, answer: { type: "submit", answers } };
}

const USER_FACING_FAILURE_TAGS = new Set(["QuestionRequestError", "EnvironmentAuthorizationError"]);

/** Known server errors pass their message through; anything else gets generic copy. */
export function questionRequestFailureMessage(failure: unknown): string {
  if (
    typeof failure === "object" &&
    failure !== null &&
    "_tag" in failure &&
    typeof failure._tag === "string" &&
    USER_FACING_FAILURE_TAGS.has(failure._tag) &&
    "message" in failure &&
    typeof failure.message === "string" &&
    failure.message.trim().length > 0
  ) {
    return failure.message;
  }
  return "Could not send the answer. Try again.";
}
