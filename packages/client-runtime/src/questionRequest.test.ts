import { describe, expect, it } from "vite-plus/test";
import { ThreadId, TurnItemId, type QuestionRequestQuestion } from "@moonfold/contracts";

import {
  questionRequestAnswerInput,
  questionRequestAnswerSummary,
  questionRequestDisplay,
  questionRequestDraftProblem,
  setQuestionRequestCustom,
  toggleQuestionRequestChoice,
} from "./questionRequest.ts";

const direction: QuestionRequestQuestion = {
  id: "direction",
  header: "Direction",
  question: "Which direction?",
  allowCustomAnswer: true,
  options: [{ label: "Bold" }, { label: "Calm" }],
};
const extras: QuestionRequestQuestion = {
  id: "extras",
  header: "Extras",
  question: "What else?",
  multiSelect: true,
  allowCustomAnswer: true,
  options: [{ label: "Logo" }, { label: "Icons" }, { label: "Fonts" }],
};
const item = {
  id: TurnItemId.make("turn-item:question-request:1"),
  threadId: ThreadId.make("thread-1"),
  questions: [direction, extras],
};

describe("question card drafts", () => {
  it("a single-select question keeps one choice, and Other text replaces it", () => {
    let draft = toggleQuestionRequestChoice({}, direction, "Bold");
    draft = toggleQuestionRequestChoice(draft, direction, "Calm");
    expect(draft.direction).toEqual({ selected: ["Calm"] });
    draft = setQuestionRequestCustom(draft, direction, "Playful");
    expect(draft.direction).toEqual({ selected: [], custom: "Playful" });
    // Picking a choice again drops the Other text.
    expect(toggleQuestionRequestChoice(draft, direction, "Bold").direction).toEqual({
      selected: ["Bold"],
    });
  });

  it("a multi-select question adds and removes choices and keeps its Other text", () => {
    let draft = setQuestionRequestCustom({}, extras, "Motion");
    draft = toggleQuestionRequestChoice(draft, extras, "Logo");
    draft = toggleQuestionRequestChoice(draft, extras, "Fonts");
    draft = toggleQuestionRequestChoice(draft, extras, "Logo");
    expect(draft.extras).toEqual({ selected: ["Fonts"], custom: "Motion" });
  });

  it("Submit waits until every question has an answer", () => {
    const partial = toggleQuestionRequestChoice({}, direction, "Bold");
    expect(questionRequestDraftProblem(item, partial)).toBe('Answer "Extras".');
    expect(questionRequestAnswerInput(item, { type: "submit", draft: partial })).toBeNull();
    // Blank Other text is no answer.
    const blank = setQuestionRequestCustom(partial, extras, "   ");
    expect(questionRequestDraftProblem(item, blank)).toBe('Answer "Extras".');

    const done = setQuestionRequestCustom(partial, extras, "  Motion ");
    expect(questionRequestDraftProblem(item, done)).toBeNull();
    expect(questionRequestAnswerInput(item, { type: "submit", draft: done })).toEqual({
      threadId: item.threadId,
      turnItemId: item.id,
      answer: {
        type: "submit",
        answers: {
          direction: { selected: ["Bold"] },
          extras: { selected: [], custom: "Motion" },
        },
      },
    });
  });
});

describe("question card display", () => {
  it("collapses an answered card to one line of choices", () => {
    const answered = {
      ...item,
      questionStatus: "answered" as const,
      answers: {
        direction: { selected: ["Bold"] },
        extras: { selected: ["Logo", "Icons"], custom: "Motion" },
      },
    };
    expect(questionRequestDisplay(answered, "local")).toEqual({
      kind: "answered",
      label: "Direction: Bold · Extras: Logo, Icons, Motion",
    });
    expect(
      questionRequestAnswerSummary({
        questions: [direction],
        answers: { direction: { selected: ["Calm"] } },
      }),
    ).toBe("Calm");
  });

  it("a pending card is answered only where it was asked", () => {
    const pending = { ...item, questionStatus: "pending" as const };
    expect(questionRequestDisplay(pending, "local")).toEqual({ kind: "pending" });
    expect(questionRequestDisplay(pending, "inherited").kind).toBe("pending-elsewhere");
    expect(questionRequestDisplay({ ...item, questionStatus: "cancelled" }, "local")).toEqual({
      kind: "ended",
      label: "Dismissed",
    });
  });
});
