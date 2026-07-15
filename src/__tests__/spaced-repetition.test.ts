/**
 * Unit tests for the spaced repetition service — isDeckPerfect.
 *
 * Uses an in-memory Prisma mock that applies every filter in the where
 * clause, so missing filters (e.g. userId) surface as failures.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { isDeckPerfect } from "@/services/spaced-repetition";
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
