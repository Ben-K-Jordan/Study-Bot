/**
 * The flashcard review state machine and its keyboard rules.
 */
import { describe, it, expect } from "vitest";
import {
  currentCard,
  initialReviewState,
  keyIntent,
  reviewReducer,
  type ReviewState,
} from "@/components/cards/review/review-state";
import type { StudyCard, StudyStats } from "@/services/spaced-repetition";

function card(id: string, status: StudyCard["status"] = "new"): StudyCard {
  return {
    id,
    front: `Front ${id}`,
    back: `Back ${id}`,
    tags: ["topic", "auto-repair"],
    ordinal: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
    nextDueAt: null,
    status,
    due: true,
    previews: { AGAIN: 0, HARD: 1, GOOD: 1, EASY: 4 },
  };
}

const stats: StudyStats = { newCount: 2, learningCount: 0, reviewCount: 3, masteredCount: 0, dueCount: 2 };

function rate(state: ReviewState, rating: "AGAIN" | "HARD" | "GOOD" | "EASY", status: StudyCard["status"] = "review") {
  let s = reviewReducer(state, { type: "reveal" });
  s = reviewReducer(s, { type: "rate-start", rating });
  return reviewReducer(s, {
    type: "rate-success",
    rating,
    result: {
      status: rating === "AGAIN" ? "learning" : status,
      intervalDays: rating === "AGAIN" ? 0 : 1,
      nextDueAt: rating === "AGAIN" ? "2026-10-15T18:10:00Z" : "2026-10-16T08:00:00Z",
      previews: { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 4 },
      xpEarned: 2,
    },
  });
}

describe("reviewReducer", () => {
  it("shows the answer before rating and ignores ratings on the question side", () => {
    const start = initialReviewState([card("a"), card("b")], stats);
    expect(start.phase).toBe("question");
    expect(reviewReducer(start, { type: "rate-start", rating: "GOOD" })).toBe(start);
    expect(reviewReducer(start, { type: "reveal" }).phase).toBe("answer");
  });

  it("re-queues a card rated Again and finishes after every card passes", () => {
    let s = initialReviewState([card("a"), card("b")], stats);
    s = rate(s, "AGAIN");
    expect(s.queue).toEqual(["a", "b", "a"]);
    expect(s.finished).toBe(0);
    expect(currentCard(s)?.id).toBe("b");
    s = rate(s, "GOOD");
    expect(currentCard(s)?.id).toBe("a");
    expect(currentCard(s)?.status).toBe("learning");
    s = rate(s, "EASY");
    expect(s.phase).toBe("done");
    expect(s.finished).toBe(2);
    expect(s.ratings).toEqual({ AGAIN: 1, HARD: 0, GOOD: 1, EASY: 1 });
    expect(s.xp).toBe(6);
  });

  it("keeps the counts current as cards change status", () => {
    let s = initialReviewState([card("a"), card("b")], stats);
    s = rate(s, "AGAIN");
    expect(s.stats).toMatchObject({ newCount: 1, learningCount: 1, dueCount: 2 });
    s = rate(s, "GOOD");
    expect(s.stats).toMatchObject({ newCount: 0, learningCount: 1, reviewCount: 4, dueCount: 1 });
    s = rate(s, "GOOD");
    expect(s.stats).toMatchObject({ learningCount: 0, reviewCount: 5, dueCount: 0 });
    expect(s.earliestNext).toBe("2026-10-16T08:00:00Z");
  });

  it("keeps the answer up after a failed rating so it can be retried", () => {
    let s = initialReviewState([card("a")], stats);
    s = reviewReducer(s, { type: "reveal" });
    s = reviewReducer(s, { type: "rate-start", rating: "GOOD" });
    s = reviewReducer(s, { type: "rate-failure", message: "Rating not saved." });
    expect(s.phase).toBe("answer");
    expect(s.submitting).toBeNull();
    expect(s.error).toBe("Rating not saved.");
  });

  it("starts an empty deck on the done screen without a card", () => {
    const s = initialReviewState([], stats);
    expect(s.phase).toBe("done");
    expect(currentCard(s)).toBeNull();
  });

  it("drops the internal auto-repair tag", () => {
    expect(initialReviewState([card("a")], stats).cards.a.tags).toEqual(["topic"]);
  });
});

describe("keyIntent", () => {
  const press = (key: string, extra: Partial<{ repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) => ({
    key,
    repeat: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    ...extra,
  });
  const on = (selector: string | null) => ({ closest: (s: string) => (selector && s.includes(selector) ? {} : null) });
  const body = on(null);

  it("reveals with Space or Enter on the question side unless a control has focus", () => {
    expect(keyIntent(press(" "), body, { phase: "question", submitting: null })).toEqual({ type: "reveal" });
    expect(keyIntent(press("Enter"), body, { phase: "question", submitting: null })).toEqual({ type: "reveal" });
    expect(keyIntent(press("Enter"), on("button"), { phase: "question", submitting: null })).toBeNull();
    expect(keyIntent(press(" "), on("a[href]"), { phase: "question", submitting: null })).toBeNull();
  });

  it("rates with 1 to 4 only after the answer is shown", () => {
    expect(keyIntent(press("3"), body, { phase: "question", submitting: null })).toBeNull();
    expect(keyIntent(press("1"), body, { phase: "answer", submitting: null })).toEqual({ type: "rate", rating: "AGAIN" });
    expect(keyIntent(press("4"), on("button"), { phase: "answer", submitting: null })).toEqual({ type: "rate", rating: "EASY" });
    expect(keyIntent(press("5"), body, { phase: "answer", submitting: null })).toBeNull();
  });

  it("ignores number keys when single-key shortcuts are off, but Space still reveals", () => {
    const off = { singleKeys: false };
    expect(keyIntent(press("3"), body, { phase: "answer", submitting: null }, off)).toBeNull();
    expect(keyIntent(press(" "), body, { phase: "question", submitting: null }, off)).toEqual({ type: "reveal" });
    expect(keyIntent(press("3"), body, { phase: "answer", submitting: null }, { singleKeys: true })).toEqual({
      type: "rate",
      rating: "GOOD",
    });
  });

  it("does nothing on the done screen, while saving, in fields, on repeat, or with modifiers", () => {
    expect(keyIntent(press("3"), body, { phase: "done", submitting: null })).toBeNull();
    expect(keyIntent(press(" "), body, { phase: "done", submitting: null })).toBeNull();
    expect(keyIntent(press("3"), body, { phase: "answer", submitting: "GOOD" })).toBeNull();
    expect(keyIntent(press("3"), on("textarea"), { phase: "answer", submitting: null })).toBeNull();
    expect(keyIntent(press("3", { repeat: true }), body, { phase: "answer", submitting: null })).toBeNull();
    expect(keyIntent(press("3", { ctrlKey: true }), body, { phase: "answer", submitting: null })).toBeNull();
  });
});
