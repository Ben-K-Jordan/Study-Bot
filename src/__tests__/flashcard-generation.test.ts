/**
 * Generating a deck when the AI's output has no usable card: the parse
 * fails (so the gateway doesn't cache the empty list and Retry asks the
 * model again), and the student gets the NO_CARDS error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    contentChunk: { findMany: vi.fn(async () => [{ text: "Chunk one" }, { text: "Chunk two" }]) },
    contentDocument: { count: vi.fn(async () => 1) },
    flashcardDeck: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/ai/provider-factory", () => ({ createProvider: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/prompt-registry", () => ({ getPrompt: vi.fn(() => ({ version: "test" })) }));

// The gateway's contract, reduced: parse the provider's output, and only a
// successful parse is returned (and cached).
const providerOutput = vi.fn<() => unknown>();
const cached: unknown[] = [];
vi.mock("@/lib/ai/gateway", () => ({
  runTask: vi.fn(async (_ctx: unknown, spec: { parseOutput: (raw: unknown) => unknown }) => {
    const raw = providerOutput();
    let output: unknown;
    try {
      output = spec.parseOutput(raw);
    } catch (err) {
      throw Object.assign(new Error(`Failed to parse AI output: ${String(err)}`), { code: "PARSE_ERROR" });
    }
    cached.push(raw);
    return { output, meta: {} };
  }),
}));

import { FlashcardError, generateFlashcardsFromCourse } from "@/services/flashcards";
import { prisma } from "@/lib/db";

beforeEach(() => {
  vi.clearAllMocks();
  cached.length = 0;
});

describe("generateFlashcardsFromCourse with an empty AI card list", () => {
  it("fails the parse, so nothing is cached, and reports NO_CARDS", async () => {
    providerOutput.mockReturnValue({ cards: [{ front: "", back: "" }, "nonsense"] });

    const error = await generateFlashcardsFromCourse("user-1", "CS 2110").catch((err: unknown) => err);

    expect(error).toBeInstanceOf(FlashcardError);
    expect((error as FlashcardError).code).toBe("NO_CARDS");
    expect(cached).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("asks the model again on retry", async () => {
    providerOutput.mockReturnValueOnce({ cards: [] });
    await expect(generateFlashcardsFromCourse("user-1", "CS 2110")).rejects.toMatchObject({ code: "NO_CARDS" });

    providerOutput.mockReturnValueOnce({ cards: [{ front: "Q1", back: "A1" }] });
    vi.mocked(prisma.$transaction).mockResolvedValueOnce({
      id: "deck-1",
      userId: "user-1",
      courseName: "CS 2110",
      examName: null,
      documentId: null,
      title: "All CS 2110 materials",
      cardCount: 1,
      createdAt: new Date("2026-10-15T12:00:00Z"),
    } as never);

    const deck = await generateFlashcardsFromCourse("user-1", "CS 2110");

    expect(providerOutput).toHaveBeenCalledTimes(2);
    expect(deck.card_count).toBe(1);
    expect(cached).toHaveLength(1);
  });

  it("passes other gateway failures through unchanged", async () => {
    providerOutput.mockReturnValue("not json at all");
    const { runTask } = await import("@/lib/ai/gateway");
    vi.mocked(runTask).mockRejectedValueOnce(Object.assign(new Error("AI provider failed"), { code: "PROVIDER_ERROR" }));

    await expect(generateFlashcardsFromCourse("user-1", "CS 2110")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
  });
});
