/**
 * Unit tests for the flashcard review route — deck ownership validation and
 * perfect-deck bonus deduplication.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    flashcardDeck: {
      findUnique: vi.fn(),
    },
    xpEvent: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/services/spaced-repetition", () => ({
  reviewCard: vi.fn(),
  isDeckPerfect: vi.fn(),
}));

vi.mock("@/services/gamification", () => ({
  awardXp: vi.fn(),
}));

import { POST } from "@/app/api/flashcards/[deckId]/review/route";
import { prisma } from "@/lib/db";
import { reviewCard, isDeckPerfect } from "@/services/spaced-repetition";
import { awardXp } from "@/services/gamification";

const mockedFindDeck = vi.mocked(prisma.flashcardDeck.findUnique);
const mockedFindXpEvent = vi.mocked(prisma.xpEvent.findFirst);
const mockedReviewCard = vi.mocked(reviewCard);
const mockedIsDeckPerfect = vi.mocked(isDeckPerfect);
const mockedAwardXp = vi.mocked(awardXp);

const REVIEW_RESULT = {
  cardId: "card1",
  easeFactor: 2.5,
  intervalDays: 1,
  repetitions: 1,
  nextDueAt: "2026-07-16T04:00:00.000Z",
  rating: "GOOD",
};

function makeRequest(
  body: unknown,
  userId: string | null = "user1",
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-user-id"] = userId;
  return new Request("http://localhost/api/flashcards/deck1/review", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

function callRoute(body: unknown, userId: string | null = "user1") {
  return POST(makeRequest(body, userId), {
    params: Promise.resolve({ deckId: "deck1" }),
  });
}

function mockDeck(userId: string, containsCard: boolean): void {
  mockedFindDeck.mockResolvedValue({
    userId,
    cards: containsCard ? [{ id: "card1" }] : [],
  } as never);
}

const NOW = new Date("2026-07-15T10:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mockedReviewCard.mockResolvedValue(REVIEW_RESULT);
  mockedIsDeckPerfect.mockResolvedValue(false);
  mockedFindXpEvent.mockResolvedValue(null);
  mockedAwardXp.mockImplementation(async (_userId, action) => ({
    id: "evt1",
    xpAmount: action === "PERFECT_DECK" ? 3 : 2,
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("POST /api/flashcards/[deckId]/review", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await callRoute({ card_id: "card1", rating: "GOOD" }, null);
    expect(res.status).toBe(401);
  });

  it("returns 404 when the deck does not exist", async () => {
    mockedFindDeck.mockResolvedValue(null as never);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });

    expect(res.status).toBe(404);
    expect(mockedReviewCard).not.toHaveBeenCalled();
    expect(mockedAwardXp).not.toHaveBeenCalled();
  });

  it("returns 403 when the deck belongs to another user", async () => {
    mockDeck("someone-else", true);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });

    expect(res.status).toBe(403);
    expect(mockedReviewCard).not.toHaveBeenCalled();
    expect(mockedAwardXp).not.toHaveBeenCalled();
  });

  it("returns 404 when the card is not in the deck", async () => {
    mockDeck("user1", false);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });

    expect(res.status).toBe(404);
    expect(mockedReviewCard).not.toHaveBeenCalled();
    expect(mockedAwardXp).not.toHaveBeenCalled();
  });

  it("awards review XP without a bonus when the deck is not perfect", async () => {
    mockDeck("user1", true);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.xpEarned).toBe(2);
    expect(json.perfectDeck).toBe(false);
    expect(mockedAwardXp).toHaveBeenCalledTimes(1);
    expect(mockedAwardXp).toHaveBeenCalledWith("user1", "FLASHCARD_REVIEW", undefined, "card1");
  });

  it("awards the perfect-deck bonus the first time the deck is perfect today", async () => {
    mockDeck("user1", true);
    mockedIsDeckPerfect.mockResolvedValue(true);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.xpEarned).toBe(5);
    expect(json.perfectDeck).toBe(true);
    expect(mockedAwardXp).toHaveBeenCalledWith("user1", "PERFECT_DECK", undefined, "deck1");

    // Dedupe lookup is scoped to this deck, this user, today (UTC)
    expect(mockedFindXpEvent).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        action: "PERFECT_DECK",
        sourceId: "deck1",
        createdAt: { gte: new Date("2026-07-15T00:00:00.000Z") },
      },
      select: { id: true },
    });
  });

  it("does not re-award the bonus when it was already granted today", async () => {
    mockDeck("user1", true);
    mockedIsDeckPerfect.mockResolvedValue(true);
    mockedFindXpEvent.mockResolvedValue({ id: "existing" } as never);

    const res = await callRoute({ card_id: "card1", rating: "GOOD" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.xpEarned).toBe(2);
    expect(json.perfectDeck).toBe(true);
    expect(mockedAwardXp).toHaveBeenCalledTimes(1);
    expect(mockedAwardXp).toHaveBeenCalledWith("user1", "FLASHCARD_REVIEW", undefined, "card1");
  });

  it("skips the perfect-deck check for AGAIN ratings", async () => {
    mockDeck("user1", true);

    const res = await callRoute({ card_id: "card1", rating: "AGAIN" });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.perfectDeck).toBe(false);
    expect(mockedIsDeckPerfect).not.toHaveBeenCalled();
  });

  it("maps service errors to 404/403", async () => {
    mockDeck("user1", true);

    mockedReviewCard.mockRejectedValueOnce(new Error("Card not found"));
    expect((await callRoute({ card_id: "card1", rating: "GOOD" })).status).toBe(404);

    mockedReviewCard.mockRejectedValueOnce(new Error("Forbidden"));
    expect((await callRoute({ card_id: "card1", rating: "GOOD" })).status).toBe(403);
  });

  it("returns 400 for an invalid body", async () => {
    const res = await callRoute({ card_id: "card1", rating: "MEDIUM" });
    expect(res.status).toBe(400);
    expect(mockedFindDeck).not.toHaveBeenCalled();
  });
});
