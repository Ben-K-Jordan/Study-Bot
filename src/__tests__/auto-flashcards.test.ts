/**
 * Unit tests for createFlashcardsFromErrors — deck lookup and race recovery
 * (outside the transaction, since a failed statement aborts a PostgreSQL
 * transaction), transactional card writes, ordinal derivation from real card
 * data, answerable-front transforms, correction-first backs, and recurrence
 * refresh.
 *
 * Uses an in-memory Prisma mock with an interactive $transaction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the module under test
vi.mock("@/lib/db", () => {
  const tx = {
    flashcardDeck: {
      update: vi.fn(async () => ({})),
    },
    flashcard: {
      findMany: vi.fn(async () => []),
      aggregate: vi.fn(async () => ({ _max: { ordinal: null } })),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "card-new",
        ...data,
      })),
      update: vi.fn(async () => ({})),
    },
  };
  const prisma = {
    flashcardDeck: {
      findMany: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(async () => ({})),
    },
    sessionAttempt: { findMany: vi.fn(async () => []) },
    sessionErrorLog: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    _tx: tx,
  };
  return { prisma };
});

import { buildBack, buildFront, createFlashcardsFromErrors } from "@/lib/auto-flashcards";
import { prisma } from "@/lib/db";

const tx = (prisma as unknown as {
  _tx: {
    flashcardDeck: {
      update: ReturnType<typeof vi.fn>;
    };
    flashcard: {
      findMany: ReturnType<typeof vi.fn>;
      aggregate: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
  };
})._tx;

const decks = prisma.flashcardDeck as unknown as {
  findMany: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};
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
    decks.findMany.mockResolvedValue([{ id: "deck-1", title: "Session errors" }]);
    decks.create.mockReset();
    decks.update.mockReset();
    decks.update.mockResolvedValue({});
    tx.flashcardDeck.update.mockResolvedValue({});
    tx.flashcard.findMany.mockResolvedValue([]);
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: null } });
    tx.flashcard.count.mockResolvedValue(0);
    tx.flashcard.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: "card-new",
        ...data,
      }),
    );
    tx.flashcard.update.mockResolvedValue({});
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

  it("refreshes the back of an existing card with the same front instead of skipping", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1"), makeAttempt(1, "Q2")]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "CONCEPT", correctionRule: "Newest correction for Q1" },
    ]);
    tx.flashcard.findMany.mockResolvedValue([{ id: "card-q1", front: "Q1" }]);
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: 0 } });
    tx.flashcard.count.mockResolvedValue(2);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    // Only the genuinely new front is created
    expect(created).toBe(1);
    expect(tx.flashcard.create).toHaveBeenCalledTimes(1);
    expect(tx.flashcard.create.mock.calls[0][0].data.front).toBe("Q2");
    expect(tx.flashcard.create.mock.calls[0][0].data.ordinal).toBe(1);

    // The recurring front updates the existing card's back in place,
    // with the newest correction, without touching its ordinal
    expect(tx.flashcard.update).toHaveBeenCalledTimes(1);
    const updateArg = tx.flashcard.update.mock.calls[0][0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArg.where).toEqual({ id: "card-q1" });
    expect(updateArg.data.back).toContain("Correction rule: Newest correction for Q1");
    expect(updateArg.data).not.toHaveProperty("ordinal");
  });

  it("does not call flashcard.update when no existing front recurs", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(tx.flashcard.update).not.toHaveBeenCalled();
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
    expect(data.back).toContain("Correction rule: Osmosis moves water");
    expect(data.back).toContain("Error type: Concept");
    expect(data.tags).toEqual(["concept", "auto-repair"]);
  });

  it("wraps MCQ-stem fronts into an answerable open question", async () => {
    const stem = "Which of the following best describes osmosis?";
    attemptsMock.mockResolvedValue([makeAttempt(0, stem)]);
    errorLogsMock.mockResolvedValue([
      {
        promptIndex: 0,
        errorType: "CONCEPT",
        correctionRule:
          'The correct answer is "Passive movement of water across a membrane". Common trap: confusing osmosis with solute diffusion.',
      },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    const data = tx.flashcard.create.mock.calls[0][0].data;
    expect(data.front).toBe(`From memory, with no options shown, give the correct answer to "${stem}"`);
    // The correction (with the actual answer) leads the back
    expect((data.back as string).startsWith("Correction rule: The correct answer is")).toBe(true);
  });

  it("leaves an MCQ stem untouched when the correction lacks the correct-answer marker", async () => {
    const stem = "Which of the following best describes osmosis?";
    attemptsMock.mockResolvedValue([makeAttempt(0, stem)]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "CONCEPT", correctionRule: "Osmosis moves water" },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(tx.flashcard.create.mock.calls[0][0].data.front).toBe(stem);
  });

  it("leaves non-MCQ fronts untouched even when the correction has the marker", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Define osmosis.")]);
    errorLogsMock.mockResolvedValue([
      {
        promptIndex: 0,
        errorType: "CONCEPT",
        correctionRule: 'The correct answer is "Passive water movement".',
      },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(tx.flashcard.create.mock.calls[0][0].data.front).toBe("Define osmosis.");
  });

  it("matches recurring MCQ errors against the transformed front and refreshes them", async () => {
    const stem = "Which of the following best describes osmosis?";
    const wrapped = `From memory, with no options shown, give the correct answer to "${stem}"`;
    attemptsMock.mockResolvedValue([makeAttempt(0, stem)]);
    errorLogsMock.mockResolvedValue([
      {
        promptIndex: 0,
        errorType: "CONCEPT",
        correctionRule: 'The correct answer is "Passive water movement". Common trap: solute diffusion.',
      },
    ]);
    tx.flashcard.findMany.mockResolvedValue([{ id: "card-mcq", front: wrapped }]);
    tx.flashcard.aggregate.mockResolvedValue({ _max: { ordinal: 4 } });

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
    expect(tx.flashcard.create).not.toHaveBeenCalled();
    expect(tx.flashcard.update).toHaveBeenCalledTimes(1);
    expect(tx.flashcard.update.mock.calls[0][0].where).toEqual({ id: "card-mcq" });
  });

  it("builds the back correction-first with the wrong answer de-emphasized last", async () => {
    attemptsMock.mockResolvedValue([
      {
        id: "attempt-0",
        promptText: "Q1",
        userAnswer: "the wrong thing",
        selfScore: "INCORRECT",
        promptIndex: 0,
      },
    ]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "CONCEPT", correctionRule: "Osmosis moves water" },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    const back = tx.flashcard.create.mock.calls[0][0].data.back as string;
    const lines = back.split("\n");
    expect(lines[0]).toBe("Correction rule: Osmosis moves water");
    expect(lines[lines.length - 1]).toBe("Your earlier answer: the wrong thing");
    // The wrong answer never appears before the correction
    expect(back.indexOf("Correction rule:")).toBeLessThan(back.indexOf("Your earlier answer:"));
  });

  it("omits the wrong-answer line when the attempt has no recorded answer", async () => {
    attemptsMock.mockResolvedValue([
      {
        id: "attempt-0",
        promptText: "Q1",
        userAnswer: null,
        selfScore: "INCORRECT",
        promptIndex: 0,
      },
    ]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "CONCEPT", correctionRule: "Osmosis moves water" },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    const back = tx.flashcard.create.mock.calls[0][0].data.back as string;
    expect(back).not.toContain("Your earlier answer:");
  });

  it("recovers from a P2002 on deck creation by reading the deck again, outside the transaction", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany
      .mockResolvedValueOnce([]) // initial lookup misses
      .mockResolvedValueOnce([{ id: "deck-2", title: "Session errors" }]); // read again after P2002
    decks.create.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(decks.findMany).toHaveBeenCalledTimes(2);
    // The failed insert never ran inside the card transaction
    expect(decks.create.mock.invocationCallOrder[0]).toBeLessThan(transactionMock.mock.invocationCallOrder[0]);
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-2");
  });

  it("creates the deck before the transaction when none exists", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany.mockResolvedValue([]);
    decks.create.mockResolvedValue({ id: "deck-new" });
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(decks.create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        courseName: "Biology",
        title: "Session errors",
        cardCount: 0,
      },
      select: { id: true },
    });
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-new");
    expect(tx.flashcard.create.mock.calls[0][0].data.ordinal).toBe(0);
  });

  it("locks the deck row before reading ordinals, so concurrent runs take turns", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    tx.flashcard.count.mockResolvedValue(1);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(tx.flashcardDeck.update.mock.calls[0][0]).toEqual({
      where: { id: "deck-1" },
      data: { cardCount: { increment: 0 } },
    });
    expect(tx.flashcardDeck.update.mock.invocationCallOrder[0]).toBeLessThan(
      tx.flashcard.aggregate.mock.invocationCallOrder[0],
    );
  });

  it("returns 0 when the deck can't be created for a reason other than a race", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany.mockResolvedValue([]);
    decks.create.mockRejectedValueOnce(new Error("connection lost"));

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
    expect(transactionMock).not.toHaveBeenCalled();
  });

  it("returns 0 when the transaction fails", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    transactionMock.mockRejectedValueOnce(new Error("deadlock detected"));

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
  });
  it("finds a recurring MCQ card saved with the earlier wording and rewrites its front", async () => {
    const stem = "Which of the following best describes osmosis?";
    const legacy = `From memory: state the correct answer to \u2014 "${stem}" (answer without options)`;
    attemptsMock.mockResolvedValue([makeAttempt(0, stem)]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "MISCONCEPTION", correctionRule: 'The correct answer is "Passive water movement".' },
    ]);
    tx.flashcard.findMany.mockResolvedValue([{ id: "card-old", front: legacy }]);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(0);
    expect(tx.flashcard.create).not.toHaveBeenCalled();
    const update = tx.flashcard.update.mock.calls[0][0] as { where: { id: string }; data: Record<string, string> };
    expect(update.where).toEqual({ id: "card-old" });
    expect(update.data.front).toBe(`From memory, with no options shown, give the correct answer to "${stem}"`);
    expect(update.data.back).toContain("Error type: Misconception");
  });

  it("reuses and renames a deck with the earlier title", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany.mockResolvedValue([{ id: "deck-legacy", title: "Error Repair \u2014 Biology" }]);
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(decks.findMany.mock.calls[0][0]).toEqual({
      where: { userId: "user-1", courseName: "Biology", title: { in: ["Session errors", "Error Repair \u2014 Biology"] } },
      select: { id: true, title: true },
    });
    expect(decks.update).toHaveBeenCalledWith({
      where: { id: "deck-legacy" },
      data: { title: "Session errors" },
    });
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-legacy");
  });

  it("uses the current deck when a legacy deck exists beside it, whatever order they come back in", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany.mockResolvedValue([
      { id: "deck-legacy", title: "Error Repair \u2014 Biology" },
      { id: "deck-current", title: "Session errors" },
    ]);
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(decks.update).not.toHaveBeenCalled();
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-current");
  });

  it("keeps going when renaming the legacy deck collides with a new one", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1")]);
    decks.findMany
      .mockResolvedValueOnce([{ id: "deck-legacy", title: "Error Repair \u2014 Biology" }])
      .mockResolvedValueOnce([
        { id: "deck-legacy", title: "Error Repair \u2014 Biology" },
        { id: "deck-current", title: "Session errors" },
      ]);
    decks.update.mockRejectedValueOnce(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    tx.flashcard.count.mockResolvedValue(1);

    const created = await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(created).toBe(1);
    expect(tx.flashcard.create.mock.calls[0][0].data.deckId).toBe("deck-current");
  });

  it("names error types in the app's words", async () => {
    attemptsMock.mockResolvedValue([makeAttempt(0, "Q1"), makeAttempt(1, "Q2")]);
    errorLogsMock.mockResolvedValue([
      { promptIndex: 0, errorType: "PROCEDURE", correctionRule: "Rule A" },
      { promptIndex: 1, errorType: "CARELESS", correctionRule: "Rule B" },
    ]);
    tx.flashcard.count.mockResolvedValue(2);

    await createFlashcardsFromErrors("user-1", "run-1", "Biology");

    expect(tx.flashcard.create.mock.calls[0][0].data.back).toContain("Error type: Wrong steps");
    expect(tx.flashcard.create.mock.calls[1][0].data.back).toContain("Error type: Careless slip");
  });
});

describe("card text from older correction rules", () => {
  const stem = "Which of the following best describes osmosis?";

  it("wraps MCQ stems whose rule reads \"The right answer is X.\"", () => {
    expect(buildFront(stem, "The right answer is Passive water movement.")).toBe(
      `From memory, with no options shown, give the correct answer to "${stem}"`,
    );
  });

  it("drops the stored choice letter from the earlier answer", () => {
    const back = buildBack({ errorType: "MISCONCEPTION", correctionRule: "Water moves." }, "[B] Active transport");
    expect(back.endsWith("Your earlier answer: Active transport")).toBe(true);
  });
});
