/**
 * Unit tests for the spaced repetition service — isDeckPerfect.
 *
 * Uses an in-memory Prisma mock that applies every filter in the where
 * clause, so missing filters (e.g. userId) surface as failures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

interface DeckRow {
  id: string;
  userId: string;
  cardIds: string[];
}

interface ReviewRow {
  cardId: string;
  userId: string;
  rating: string;
  createdAt: Date;
}

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const decks: DeckRow[] = [];
  const reviews: ReviewRow[] = [];

  return {
    prisma: {
      flashcardDeck: {
        findFirst: vi.fn(
          async ({ where }: { where: { id?: string; userId?: string } }) => {
            const deck = decks.find(
              (d) =>
                (where.id === undefined || d.id === where.id) &&
                (where.userId === undefined || d.userId === where.userId),
            );
            if (!deck) return null;
            return { cards: deck.cardIds.map((id) => ({ id })) };
          },
        ),
      },
      cardReview: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: { userId: string; cardId: { in: string[] }; createdAt: { gte: Date } };
          }) =>
            reviews
              .filter(
                (r) =>
                  r.userId === where.userId &&
                  where.cardId.in.includes(r.cardId) &&
                  r.createdAt >= where.createdAt.gte,
              )
              .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        ),
      },
      _test: { decks, reviews },
    },
  };
});

import { computeSM2, isDeckPerfect } from "@/services/spaced-repetition";
import { prisma } from "@/lib/db";

const testPrisma = (
  prisma as unknown as { _test: { decks: DeckRow[]; reviews: ReviewRow[] } }
)._test;

function addReview(cardId: string, rating: string, createdAt: Date, userId = "user1"): void {
  testPrisma.reviews.push({ cardId, userId, rating, createdAt });
}

// All review timestamps are "today" relative to the real clock
const now = () => new Date();

beforeEach(() => {
  testPrisma.decks.length = 0;
  testPrisma.reviews.length = 0;
  vi.clearAllMocks();
});

describe("isDeckPerfect", () => {
  it("returns false for an unknown deck", async () => {
    expect(await isDeckPerfect("user1", "missing-deck")).toBe(false);
  });

  it("returns false for another user's deck", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "someone-else", cardIds: ["c1"] });
    addReview("c1", "GOOD", now(), "someone-else");

    expect(await isDeckPerfect("user1", "deck1")).toBe(false);
  });

  it("returns false for a deck with no cards (no vacuous perfection)", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "user1", cardIds: [] });

    expect(await isDeckPerfect("user1", "deck1")).toBe(false);
  });

  it("returns true when every card's latest review today is not AGAIN", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "user1", cardIds: ["c1", "c2"] });
    addReview("c1", "GOOD", now());
    addReview("c2", "EASY", now());

    expect(await isDeckPerfect("user1", "deck1")).toBe(true);
  });

  it("returns false when a card has not been reviewed today", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "user1", cardIds: ["c1", "c2"] });
    addReview("c1", "GOOD", now());

    expect(await isDeckPerfect("user1", "deck1")).toBe(false);
  });

  it("returns false when a card's latest review is AGAIN", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "user1", cardIds: ["c1", "c2"] });
    addReview("c1", "GOOD", now());
    addReview("c2", "GOOD", new Date(Date.now() - 60_000));
    addReview("c2", "AGAIN", now());

    expect(await isDeckPerfect("user1", "deck1")).toBe(false);
  });

  it("uses only the most recent review per card", async () => {
    testPrisma.decks.push({ id: "deck1", userId: "user1", cardIds: ["c1"] });
    addReview("c1", "AGAIN", new Date(Date.now() - 60_000));
    addReview("c1", "GOOD", now());

    expect(await isDeckPerfect("user1", "deck1")).toBe(true);
  });
});

describe("computeSM2 exam awareness", () => {
  const DAY = 24 * 60 * 60 * 1000;

  // computeSM2 reads the real clock internally, so freeze time for
  // deterministic days-until-exam arithmetic.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const examIn = (days: number) => new Date(Date.now() + days * DAY);

  it("keeps existing scheduling when no exam date is given", () => {
    expect(computeSM2(2.5, 0, 0, "GOOD").intervalDays).toBe(1);
    expect(computeSM2(2.5, 1, 1, "GOOD").intervalDays).toBe(6);
    expect(computeSM2(2.5, 6, 2, "GOOD").intervalDays).toBe(15); // round(6*2.5)
  });

  it("treats a null exam date like no exam date", () => {
    const withNull = computeSM2(2.5, 6, 2, "GOOD", null);
    const without = computeSM2(2.5, 6, 2, "GOOD");
    expect(withNull).toEqual(without);
  });

  it("compresses to daily review when the exam is within 3 days", () => {
    expect(computeSM2(2.5, 6, 2, "GOOD", examIn(2)).intervalDays).toBe(1);
  });

  it("caps at 2 days when the exam is 4-7 days out", () => {
    expect(computeSM2(2.5, 6, 2, "GOOD", examIn(5)).intervalDays).toBe(2);
  });

  it("caps at 3 days when the exam is 8-14 days out", () => {
    expect(computeSM2(2.5, 6, 2, "GOOD", examIn(10)).intervalDays).toBe(3);
  });

  it("caps at ~20% of remaining days for far exams, never lengthening", () => {
    expect(computeSM2(2.5, 6, 2, "GOOD", examIn(30)).intervalDays).toBe(6); // floor(30*0.2)
    expect(computeSM2(2.5, 6, 2, "GOOD", examIn(120)).intervalDays).toBe(15); // cap 24 > 15
    // Shorter-than-cap intervals stay put
    expect(computeSM2(2.5, 0, 0, "GOOD", examIn(30)).intervalDays).toBe(1);
  });

  it("preserves the 10-minute learning step for AGAIN even with an exam", () => {
    const result = computeSM2(2.5, 6, 2, "AGAIN", examIn(2));
    expect(result.intervalDays).toBe(0);
    expect(result.repetitions).toBe(0);
    expect(result.nextDueAt).toEqual(new Date(Date.now() + 10 * 60 * 1000));
  });

  it("does not change ease factor or repetitions when compressing", () => {
    const withExam = computeSM2(2.5, 6, 2, "GOOD", examIn(2));
    const without = computeSM2(2.5, 6, 2, "GOOD");
    expect(withExam.easeFactor).toBe(without.easeFactor);
    expect(withExam.repetitions).toBe(without.repetitions);
  });
});
