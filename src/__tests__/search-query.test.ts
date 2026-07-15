import { describe, it, expect } from "vitest";
import { buildFeedbackQuery } from "@/lib/search";

describe("buildFeedbackQuery", () => {
  it("combines prompt text and correction rule", () => {
    const q = buildFeedbackQuery("Explain loops", "Must init counter before loop");
    expect(q).toContain("Explain loops");
    expect(q).toContain("Must init counter before loop");
  });

  it("includes objective title when provided", () => {
    const q = buildFeedbackQuery("What is X?", "correction", "Algorithms");
    expect(q).toContain("Algorithms");
  });

  it("handles missing optional params", () => {
    const q = buildFeedbackQuery("prompt only");
    expect(q).toBe("prompt only");
  });

  it("truncates to max 200 chars", () => {
    const long = "a".repeat(300);
    const q = buildFeedbackQuery(long);
    expect(q.length).toBe(200);
  });

  it("returns empty-ish for empty prompt", () => {
    const q = buildFeedbackQuery("");
    expect(q).toBe("");
  });
});
