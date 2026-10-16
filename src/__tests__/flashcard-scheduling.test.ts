/**
 * Flashcard scheduling: statuses, due-today on the student's clock, interval
 * previews, and reviewCard capping intervals with the deck's exam date.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/db", () => {
  const tx = {
    flashcard: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
    cardReview: { create: vi.fn(async () => ({})) },
  };
  return {
    prisma: {
      flashcard: { findUnique: vi.fn() },
      studyPlan: { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) },
      userGameState: { findUnique: vi.fn(async () => ({ timezone: "America/New_York" })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
      _tx: tx,
    },
  };
});

import { prisma } from "@/lib/db";
import {
  cardStatus,
  computeSM2,
  deckStats,
  endOfToday,
  findUpcomingExam,
  intervalPreviews,
  isDueToday,
  nextDueAfterToday,
  reviewCard,
} from "@/services/spaced-repetition";

const db = prisma as unknown as {
  flashcard: { findUnique: ReturnType<typeof vi.fn> };
  studyPlan: { findMany: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
  userGameState: { findUnique: ReturnType<typeof vi.fn> };
  _tx: {
    flashcard: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    cardReview: { create: ReturnType<typeof vi.fn> };
  };
};

const NOW = new Date("2026-10-15T18:00:00Z"); // 2:00 PM in New York

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  db.studyPlan.findMany.mockResolvedValue([]);
  db.studyPlan.findFirst.mockResolvedValue(null);
  db.userGameState.findUnique.mockResolvedValue({ timezone: "America/New_York" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cardStatus", () => {
  it("names the four statuses", () => {
    expect(cardStatus({ repetitions: 0, intervalDays: 0, nextDueAt: null })).toBe("new");
    expect(cardStatus({ repetitions: 0, intervalDays: 0, nextDueAt: NOW })).toBe("learning");
    expect(cardStatus({ repetitions: 2, intervalDays: 6, nextDueAt: NOW })).toBe("review");
    expect(cardStatus({ repetitions: 5, intervalDays: 21, nextDueAt: NOW })).toBe("mastered");
  });
});

describe("computeSM2 with a time zone", () => {
  it("brings day intervals due at 4:00 AM on the student's clock", () => {
    const result = computeSM2(2.5, 0, 0, "GOOD", null, { timeZone: "America/New_York", now: NOW });
    expect(result.intervalDays).toBe(1);
    // Oct 16, 4:00 AM EDT is 08:00 UTC
    expect(result.nextDueAt.toISOString()).toBe("2026-10-16T08:00:00.000Z");
  });

  it("falls back to 4:00 AM UTC without a zone, never the server clock", () => {
    const result = computeSM2(2.5, 0, 0, "GOOD", null, { timeZone: null, now: new Date("2026-10-15T21:30:00Z") });
    expect(result.nextDueAt.toISOString()).toBe("2026-10-16T04:00:00.000Z");
  });

  it("keeps the 10-minute learning step for Again", () => {
    const result = computeSM2(2.5, 6, 2, "AGAIN", null, { timeZone: "America/New_York", now: NOW });
    expect(result.nextDueAt.getTime()).toBe(NOW.getTime() + 10 * 60 * 1000);
  });
});

describe("intervalPreviews", () => {
  it("previews each rating with the exam cap applied", () => {
    const card = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };
    expect(intervalPreviews(card, null, NOW)).toEqual({ AGAIN: 0, HARD: 14, GOOD: 15, EASY: 16 });
    const examInFive = new Date(NOW.getTime() + 5 * 86_400_000);
    expect(intervalPreviews(card, examInFive, NOW)).toEqual({ AGAIN: 0, HARD: 2, GOOD: 2, EASY: 2 });
  });
});

describe("due today", () => {
  const todayEnds = endOfToday("America/New_York", NOW);

  it("ends today at midnight on the student's clock", () => {
    expect(todayEnds.toISOString()).toBe("2026-10-16T04:00:00.000Z");
  });

  it("counts new cards and cards due before midnight", () => {
    expect(isDueToday({ repetitions: 0, intervalDays: 0, nextDueAt: null }, todayEnds)).toBe(true);
    expect(isDueToday({ repetitions: 1, intervalDays: 1, nextDueAt: "2026-10-15T08:00:00Z" }, todayEnds)).toBe(true);
    expect(isDueToday({ repetitions: 1, intervalDays: 1, nextDueAt: "2026-10-16T08:00:00Z" }, todayEnds)).toBe(false);
  });

  it("totals statuses and due cards, and finds the next review after today", () => {
    const cards = [
      { repetitions: 0, intervalDays: 0, nextDueAt: null },
      { repetitions: 0, intervalDays: 0, nextDueAt: new Date("2026-10-15T18:10:00Z") },
      { repetitions: 2, intervalDays: 6, nextDueAt: new Date("2026-10-18T08:00:00Z") },
      { repetitions: 6, intervalDays: 30, nextDueAt: new Date("2026-10-17T08:00:00Z") },
    ];
    expect(deckStats(cards, todayEnds)).toEqual({
      newCount: 1,
      learningCount: 1,
      reviewCount: 1,
      masteredCount: 1,
      dueCount: 2,
    });
    expect(nextDueAfterToday(cards, todayEnds)).toBe("2026-10-17T08:00:00.000Z");
  });
});

describe("findUpcomingExam", () => {
  it("prefers the deck's own exam, else the course's nearest", async () => {
    db.studyPlan.findMany.mockResolvedValue([
      { examName: "Prelim 2", examDate: new Date("2026-10-22T00:00:00Z") },
      { examName: "Final", examDate: new Date("2026-12-14T00:00:00Z") },
    ]);
    expect((await findUpcomingExam("u1", "INFO 1300", "Final", NOW))?.examName).toBe("Final");
    expect((await findUpcomingExam("u1", "INFO 1300", "Prelim 9", NOW))?.examName).toBe("Prelim 2");
    expect((await findUpcomingExam("u1", "INFO 1300", null, NOW))?.examName).toBe("Prelim 2");
    // Exams today still count: the query starts at today's calendar date
    expect(db.studyPlan.findMany.mock.calls[0][0].where.examDate.gte.toISOString()).toBe("2026-10-15T00:00:00.000Z");
  });
});

describe("reviewCard", () => {
  function mockCard(state: { easeFactor: number; intervalDays: number; repetitions: number }) {
    db.flashcard.findUnique.mockResolvedValue({
      deck: { userId: "u1", courseName: "INFO 1300", examName: "Prelim 2" },
    });
    db._tx.flashcard.findUnique.mockResolvedValue({ id: "c1", ...state, deck: { userId: "u1" } });
  }

  it("caps the interval with the deck's exam date", async () => {
    mockCard({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });
    db.studyPlan.findMany.mockResolvedValue([
      { examName: "Prelim 2", examDate: new Date("2026-10-22T00:00:00Z") },
    ]);

    const result = await reviewCard("u1", "c1", "GOOD");

    // Without the exam this would be 15 days; 6 days out caps it at 2.
    expect(result.intervalDays).toBe(2);
    expect(result.status).toBe("review");
    expect(db._tx.flashcard.update.mock.calls[0][0].data.intervalDays).toBe(2);
    // Due at 4:00 AM New York time, two days on
    expect(result.nextDueAt).toBe("2026-10-17T08:00:00.000Z");
    expect(result.previews.GOOD).toBeLessThanOrEqual(2);
  });

  it("schedules normally when the course has no upcoming exam", async () => {
    mockCard({ easeFactor: 2.5, intervalDays: 6, repetitions: 2 });

    const result = await reviewCard("u1", "c1", "GOOD");

    expect(result.intervalDays).toBe(15);
  });

  it("uses the newest plan's zone when Settings has none, like streaks and Study", async () => {
    mockCard({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 });
    db.userGameState.findUnique.mockResolvedValue({ timezone: null });
    db.studyPlan.findFirst.mockResolvedValue({ timezone: "America/New_York" });
    vi.setSystemTime(new Date("2026-10-15T21:30:00Z")); // 5:30 PM in New York

    const result = await reviewCard("u1", "c1", "GOOD");

    // Tomorrow at 4:00 AM New York time, so it isn't due again this evening
    expect(result.nextDueAt).toBe("2026-10-16T08:00:00.000Z");
    const eveningEnds = endOfToday("America/New_York", new Date("2026-10-16T00:30:00Z"));
    expect(isDueToday({ repetitions: 1, intervalDays: 1, nextDueAt: result.nextDueAt }, eveningEnds)).toBe(false);
  });

  it("takes a zone the caller already looked up", async () => {
    mockCard({ easeFactor: 2.5, intervalDays: 0, repetitions: 0 });

    const result = await reviewCard("u1", "c1", "GOOD", Promise.resolve("Asia/Tokyo"));

    // It's 3:00 AM on Oct 16 in Tokyo; one day on is Oct 17 at 4:00 AM JST
    expect(result.nextDueAt).toBe("2026-10-16T19:00:00.000Z");
    expect(db.userGameState.findUnique).not.toHaveBeenCalled();
  });

  it("refuses another user's card", async () => {
    db.flashcard.findUnique.mockResolvedValue({
      deck: { userId: "someone-else", courseName: "INFO 1300", examName: null },
    });
    await expect(reviewCard("u1", "c1", "GOOD")).rejects.toThrow("Forbidden");
    expect(db._tx.flashcard.update).not.toHaveBeenCalled();
  });
});
