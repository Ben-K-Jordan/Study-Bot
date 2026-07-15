/**
 * Unit tests for createFlashcardsFromErrors — transactional deck handling,
 * ordinal derivation from real card data, and race recovery.
 *
 * Uses an in-memory Prisma mock with an interactive $transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/db", () => {
  const tx = {
    flashcardDeck: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    flashcard: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _max: { ordinal: null } })),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
  const prisma = {
    sessionAttempt: { findMany: vi.fn(async () => []) },
    sessionErrorLog: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
  return { prisma };
});

import { createFlashcardsFromErrors } from "@/lib/auto-flashcards";
import { prisma } from "@/lib/db";

const tx = (prisma as unknown as {
  _tx: {
    flashcardDeck: {
      findFirst: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    flashcard: {
      findMany: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
  };
})._tx;

const attemptsMock = prisma.sessionAttempt.findMany as ReturnType<typeof vi.fn>;
const errorLogsMock = prisma.sessionErrorLog.findMany as ReturnType<typeof vi.fn>;
const transactionMock = prisma.$transaction as ReturnType<typeof vi.fn>;

function makeAttempt(index: number, promptText: string) {
  return {
    id: `attempt-${index}`,
    promptText,
    userAnswer: `answer ${index}`,
    selfScore: "INCORRECT",
    promptIndex: index,
  };
}

describe("createFlashcardsFromErrors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tx.flashcardDeck.findFirst.mockResolvedValue({ id: "deck-1" });
    tx.flashcardDeck.update.mockResolvedValue({});
    tx.flashcard.findMany.mockResolvedValue([]);
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: null } });
    tx.flashcard.count.mockResolvedValue(0);
    tx.flashcard.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => data,
    );
    attemptsMock.mockResolvedValue([]);
    errorLogsMock.mockResolvedValue([]);
  });

  it("returns 0 without opening a transaction when there are no errors", async () => {
    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("derives ordinals from MAX(ordinal), not the cached cardCount", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1"), makeAttempt(1, "Q2")]);
    // cardCount is stale (would say 3), but the deck really has cards up to ordinal 7
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: 7 } });
    tx.flashcard.count.mockResolvedValue(10);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(2);
    const ordinals = tx.flashcard.create.mock.calls.map(
      (c) => (c[0] as { data: { ordinal: number } }).data.ordinal,
    );
    expect(ordinals).toEqual([8, 9]);

    // cardCount is set from the real card count, not an incremented guess
    expect(tx.flashcardDeck.update).toHaveBeenCalledWith({
      where: { id: "deck-1" },
      data: { cardCount: 10 },
    });
  });

  it("skips attempts that already have a card with the same front", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1"), makeAttempt(1, "Q2")]);
    tx.flashcard.findMany.mockResolvedValue([{ front: "Q1" }]);
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: 0 } });
    tx.flashcard.count.mockResolvedValue(2);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(tx.flashcard.create).toHaveBeenCalledTimes(1);
    expect(tx.flashcard.create.mock.calls[0][0].data.front).toBe("Q2");
    expect(tx.flashcard.create.mock.calls[0][0].data.ordinal).toBe(1);
  });

  it("includes correction rules from error logs on the card back", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "CONCEPT", correctionRule: "Osmosis moves water" },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    const data = tx.flashcard.create.mock.calls[0][0].data;
    expect(data.back).toContain("Correction: Osmosis moves water");
    expect(data.tags).toEqual(["concept", "auto-repair"]);
  });

  it("recovers from a P2002 on deck creation by re-fetching the deck", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    tx.flashcardDeck.findFirst
      .mockResolvedValueOnce(null) // initial lookup misses
      .mockResolvedValueOnce({ id: "deck-2" }); // re-fetch after P2002
    tx.flashcardDeck.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(tx.flashcardDeck.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-2");
  });

  it("creates the deck inside the transaction when none exists", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    tx.flashcardDeck.findFirst.mockResolvedValue(null);
    tx.flashcardDeck.create.mockResolvedValue({ id: "deck-new" });
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(tx.flashcardDeck.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        courseName: "Biology",
        title: "Error Repair — Biology",
        cardCount: 0,
      },
      select: { id: true },
    });
    expect(tx.flashcard.create.mock.calls[0][0].data.ordinal).toBe(0);
  });

  it("returns 0 when the transaction fails", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    transactionMock.mockRejectedValueOnce(new Error("deadlock detected"));

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
  });
});
