import { describe, it, expect } from "vitest";
import { buildFeedbackQuery, questionSearchText } from "@/lib/search";

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

  it("puts the topic title first, then the correction rule, then the question", () => {
    const q = buildFeedbackQuery("Why does the loop stop?", "The guard turns false", "Loop invariants");
    expect(q).toBe("Loop invariants The guard turns false Why does the loop stop?");
  });

  it("keeps the topic title when a long question fills the cap", () => {
    const question = "Explain in detail ".repeat(30);
    const q = buildFeedbackQuery(question, "rule", "CSS specificity");
    expect(q.startsWith("CSS specificity rule")).toBe(true);
    expect(q.length).toBeLessThanOrEqual(200);
  });

  it("cuts at a word boundary, so no half word becomes a search term", () => {
    const q = buildFeedbackQuery("alpha ".repeat(40) + "omegaomegaomega");
    expect(q.length).toBeLessThanOrEqual(200);
    expect(q.endsWith("alpha")).toBe(true);
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

  it("drops the question templates' own wording", () => {
    expect(buildFeedbackQuery("From memory: explain Recursion in 3 to 5 bullets.", null, "Recursion")).toBe(
      "Recursion explain Recursion ."
    );
    expect(
      buildFeedbackQuery(
        "Pretest: what do you already know about stacks? Explain as much as you can from memory.",
        undefined,
        "Stacks"
      )
    ).toBe("Stacks stacks?");
  });
});

describe("questionSearchText", () => {
  it("keeps a repair question and drops its instructions", () => {
    expect(
      questionSearchText(
        "Why does a binary search need a sorted array?\n\nYou answered this incorrectly 2 days ago. From memory: state the correction rule, say why the error happens, and give a new example where the rule applies."
      )
    ).toBe("Why does a binary search need a sorted array?")
  });

  it("drops the review question's reminder of when the topic was studied", () => {
    expect(
      questionSearchText("From memory: explain Big-O and what matters most to remember about it. You last studied it 3 days ago.")
    ).toBe("explain Big-O .")
  });

  it("leaves an ordinary question alone", () => {
    expect(questionSearchText("What is the specificity of #nav a?")).toBe("What is the specificity of #nav a?")
  });
});
