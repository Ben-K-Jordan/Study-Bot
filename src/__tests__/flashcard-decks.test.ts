/**
 * Deck titles, kinds, and cleaning AI-generated cards.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { cleanGeneratedCards, deckKind, displayDeckTitle } from "@/services/flashcards";

describe("deck titles", () => {
  it("shows titles from earlier builds without dashes", () => {
    expect(displayDeckTitle("Error Repair \u2014 Biology", "Biology")).toBe("Session errors");
    expect(displayDeckTitle("Lecture 4: Stacks \u2014 Flashcards", "CS 2110")).toBe("Lecture 4: Stacks");
    expect(displayDeckTitle("CS 2110 \u2014 Prelim 1 Flashcards", "CS 2110")).toBe("All Prelim 1 materials");
    expect(displayDeckTitle("CS 2110 Flashcards", "CS 2110")).toBe("All CS 2110 materials");
    expect(displayDeckTitle("Layout and specificity", "INFO 1300")).toBe("Layout and specificity");
  });

  it("tells session-error decks from AI-written ones", () => {
    expect(deckKind("Session errors")).toBe("errors");
    expect(deckKind("Error Repair \u2014 Biology")).toBe("errors");
    expect(deckKind("All Prelim 2 materials")).toBe("generated");
  });
});

describe("cleanGeneratedCards", () => {
  it("drops malformed and empty cards and trims the rest", () => {
    const cards = cleanGeneratedCards([
      { front: "  Q1 ", back: " A1 ", tags: ["css", 3] },
      { front: "", back: "A" },
      { front: "Q", back: null },
      "nonsense",
      { front: "Q3", back: "A3" },
    ]);
    expect(cards).toEqual([
      { front: "Q1", back: "A1", tags: ["css"] },
      { front: "Q3", back: "A3", tags: undefined },
    ]);
  });

  it("returns nothing for output that isn't a list", () => {
    expect(cleanGeneratedCards(undefined)).toEqual([]);
    expect(cleanGeneratedCards({ front: "Q" })).toEqual([]);
  });
});
