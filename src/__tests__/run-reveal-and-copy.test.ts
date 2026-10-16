/**
 * The run service's reveal gate and the question text it writes.
 *
 * - The model answer is never returned for an unanswered free-recall
 *   question unless the student's answer comes with the request; that
 *   answer is committed on the question (first answer wins).
 * - Unanswered multiple-choice questions never reveal.
 * - Pretest, repair and review questions read as plain sentences: no typed
 *   dashes, no snake_case topic keys, no repair quoting another repair.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface PromptRow {
  id: string;
  runId: string;
  promptIndex: number;
  meta: Record<string, unknown> | null;
}

const store: {
  run: { userId: string; currentIndex: number; phase: string; status: string; promptCount: number } | null;
  row: PromptRow | null;
  attempt: { id: string; userAnswer: string } | null;
} = { run: null, row: null, attempt: null };

const updateRow = vi.fn(async ({ where, data }: { where: { id: string }; data: { meta: Record<string, unknown> } }) => {
  if (store.row && store.row.id === where.id) store.row = { ...store.row, meta: data.meta };
  return store.row;
});

vi.mock("@/lib/db", () => ({
  prisma: {
    sessionRun: { findUnique: vi.fn(async () => store.run) },
    sessionRunPrompt: {
      findUnique: vi.fn(async () => store.row),
      update: (args: { where: { id: string }; data: { meta: Record<string, unknown> } }) => updateRow(args),
    },
    sessionAttempt: { findUnique: vi.fn(async () => store.attempt) },
  },
}));

import {
  getAnswerReveal,
  revealGate,
  committedAnswerOf,
  variantSourceFor,
  pretestQuestionText,
  crossSessionRepairText,
  reviewQuestionText,
  humanizeObjectiveKey,
} from "@/services/run";
import { generateVariantQuestion } from "@/lib/variant-questions";

const DASHES = /[\u2013\u2014]/;

function freeRecallRow(meta: Record<string, unknown> = {}): PromptRow {
  return {
    id: "row-1",
    runId: "run-1",
    promptIndex: 0,
    meta: { model_answer: "Water moves toward solute.", key_points: ["gradient"], ...meta },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.run = { userId: "user-1", currentIndex: 0, phase: "ACTIVE", status: "ACTIVE", promptCount: 3 };
  store.row = freeRecallRow();
  store.attempt = null;
});

describe("revealGate", () => {
  const base = { phase: "ACTIVE", currentIndex: 2, index: 2, isMcq: false, answered: false, committedAnswer: null };

  it("withholds during the exam phase and for another question", () => {
    expect(revealGate({ ...base, phase: "EXAM", userAnswer: "x" })).toEqual({ kind: "wrong_phase" });
    expect(revealGate({ ...base, index: 1, userAnswer: "x" })).toEqual({ kind: "wrong_index", expected: 2 });
  });

  it("requires an answer before revealing an unanswered free-recall question", () => {
    expect(revealGate(base)).toEqual({ kind: "answer_required" });
    expect(revealGate({ ...base, userAnswer: "   " })).toEqual({ kind: "answer_required" });
  });

  it("commits the answer sent with the request", () => {
    expect(revealGate({ ...base, userAnswer: " osmosis " })).toEqual({ kind: "reveal", commit: "osmosis" });
  });

  it("keeps the first committed answer", () => {
    expect(revealGate({ ...base, committedAnswer: "first", userAnswer: "second" })).toEqual({
      kind: "reveal",
      commit: null,
    });
  });

  it("never reveals an unanswered multiple-choice question", () => {
    expect(revealGate({ ...base, isMcq: true, userAnswer: "[A] x" })).toEqual({ kind: "withhold" });
  });

  it("reveals once an attempt is recorded (exam scoring, answered MCQ)", () => {
    expect(revealGate({ ...base, phase: "REVIEW", answered: true })).toEqual({ kind: "reveal", commit: null });
    expect(revealGate({ ...base, isMcq: true, answered: true })).toEqual({ kind: "reveal", commit: null });
  });
});

describe("getAnswerReveal", () => {
  it("returns answer_required, not the model answer, when nothing was answered", async () => {
    const result = await getAnswerReveal("user-1", "run-1", 0);
    expect(result).toEqual({ error: "answer_required" });
    expect(updateRow).not.toHaveBeenCalled();
  });

  it("commits the answer and reveals the model answer", async () => {
    const result = await getAnswerReveal("user-1", "run-1", 0, { userAnswer: "osmosis" });

    expect(result).toEqual({
      data: {
        model_answer: "Water moves toward solute.",
        key_points: ["gradient"],
        committed_answer: "osmosis",
      },
    });
    expect(updateRow).toHaveBeenCalledTimes(1);
    expect(store.row?.meta?.committed_answer).toBe("osmosis");
    // The rest of the question's meta survives the commit
    expect(store.row?.meta?.model_answer).toBe("Water moves toward solute.");
  });

  it("keeps the first committed answer on a second request", async () => {
    await getAnswerReveal("user-1", "run-1", 0, { userAnswer: "first" });
    const again = await getAnswerReveal("user-1", "run-1", 0, { userAnswer: "edited after seeing it" });

    expect(updateRow).toHaveBeenCalledTimes(1);
    expect((again as { data?: { committed_answer?: string | null } }).data?.committed_answer).toBe("first");
  });

  it("reveals a committed answer's model answer again without an answer (refresh)", async () => {
    store.row = freeRecallRow({ committed_answer: "first" });
    const result = await getAnswerReveal("user-1", "run-1", 0);
    expect((result as { data?: { model_answer?: string | null } }).data?.model_answer).toBe("Water moves toward solute.");
  });

  it("withholds an unanswered MCQ even with an answer in the request", async () => {
    store.row = { ...freeRecallRow(), meta: { format: "MCQ", model_answer: "B names the right choice" } };
    const result = await getAnswerReveal("user-1", "run-1", 0, { userAnswer: "[A] something" });
    expect(result).toEqual({ data: { model_answer: null, key_points: null, committed_answer: null } });
    expect(updateRow).not.toHaveBeenCalled();
  });

  it("reveals during exam scoring, where the attempt exists", async () => {
    store.run = { ...store.run!, phase: "REVIEW" };
    store.attempt = { id: "att-1", userAnswer: "saved in the exam" };
    const result = await getAnswerReveal("user-1", "run-1", 0);
    expect(result).toEqual({
      data: { model_answer: "Water moves toward solute.", key_points: ["gradient"], committed_answer: "saved in the exam" },
    });
  });

  it("refuses during the exam phase and for other users", async () => {
    store.run = { ...store.run!, phase: "EXAM" };
    expect(await getAnswerReveal("user-1", "run-1", 0, { userAnswer: "x" })).toMatchObject({ error: "wrong_phase" });

    store.run = { ...store.run!, phase: "ACTIVE" };
    expect(await getAnswerReveal("someone-else", "run-1", 0, { userAnswer: "x" })).toEqual({ error: "forbidden" });
  });
});

describe("committedAnswerOf", () => {
  it("reads only a non-empty string", () => {
    expect(committedAnswerOf({ committed_answer: "a" })).toBe("a");
    expect(committedAnswerOf({ committed_answer: "  " })).toBeNull();
    expect(committedAnswerOf({ committed_answer: 3 })).toBeNull();
    expect(committedAnswerOf(null)).toBeNull();
  });
});

describe("question text", () => {
  it("writes the pretest question from VOICE, without quotes or dashes", () => {
    const text = pretestQuestionText("Recursion");
    expect(text).toBe("Pretest: what do you already know about Recursion? Explain as much as you can from memory.");
    expect(text).not.toMatch(DASHES);
    expect(text).not.toContain("Diagnostic");
  });

  it("puts the repair question first and keeps From memory", () => {
    const withVariant = crossSessionRepairText({ daysSince: 3, variantQuestion: "What is a base case?" });
    expect(withVariant.startsWith("What is a base case?")).toBe(true);
    expect(withVariant).toContain("From memory");
    expect(withVariant).toContain("3 days ago");

    const withOriginal = crossSessionRepairText({ daysSince: 1, originalText: "Define recursion." });
    expect(withOriginal.startsWith("Define recursion.")).toBe(true);
    expect(withOriginal).toContain("1 day ago");

    const today = crossSessionRepairText({ daysSince: 0, originalText: "Define recursion." });
    expect(today).toContain("earlier today");

    // VOICE: an incorrect answer is an error, and the student wrote a "correction rule".
    expect(withOriginal).toContain("You answered this incorrectly 1 day ago.");
    expect(crossSessionRepairText({ daysSince: 2 })).toContain("state the correction rule");

    for (const t of [withVariant, withOriginal, today, crossSessionRepairText({ daysSince: 2 })]) {
      expect(t).not.toMatch(/\b(missed|mistake|correct rule)\b/i);
      expect(t).not.toMatch(DASHES);
      expect(t).not.toMatch(/\b(MISCONCEPTION|misconception error|\d+d ago)\b/);
    }
  });

  it("names review topics, never snake_case keys", () => {
    expect(humanizeObjectiveKey("photosynthesis_light_reactions")).toBe("Photosynthesis light reactions");
    expect(humanizeObjectiveKey("bigO-notation")).toBe("Big o notation");
    const text = reviewQuestionText(humanizeObjectiveKey("photosynthesis_light_reactions"), 4);
    expect(text).toContain("Photosynthesis light reactions");
    expect(text).not.toContain("_");
    expect(text).toContain("4 days ago");
    expect(reviewQuestionText("Stacks", 0)).toContain("earlier today");
    expect(reviewQuestionText("Stacks", null)).not.toContain("last studied");
  });
});

describe("repair variants", () => {
  it("retest the original question, not the text of an earlier repair", () => {
    const first = generateVariantQuestion(3, "What does a stack frame hold?", "MISCONCEPTION", "Locals and return address");
    // A wrong answer on the repair: its source is the repair's original question
    const source = variantSourceFor({ text: first.text, meta: first.meta });
    expect(source).toBe("What does a stack frame hold?");

    const second = generateVariantQuestion(4, source, "MEMORY", "Locals and return address");
    expect(second.text.startsWith("What does a stack frame hold?")).toBe(true);
    expect(second.text.match(/What does a stack frame hold\?/g)).toHaveLength(1);
    expect(second.text).toContain("From memory");
    expect(second.text).not.toMatch(DASHES);
  });

  it("carries MCQ choices without naming the right one", () => {
    const source = variantSourceFor({
      text: "Which structure is LIFO?",
      format: "MCQ",
      choices: ["Queue", "Stack", "Heap", "Tree"],
      meta: undefined,
    });
    expect(source).toBe("Which structure is LIFO? (Choices: A. Queue; B. Stack; C. Heap; D. Tree)");
    expect(source).not.toMatch(/correct/i);
  });
});
