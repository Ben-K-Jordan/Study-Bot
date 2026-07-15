import { describe, it, expect } from "vitest";
import { generateRetrievalPrompts, shuffleMcqChoices, type Prompt } from "@/lib/prompts";

describe("generateRetrievalPrompts", () => {
  it("generates the exact number of prompts from target_outcome.prompt_count", () => {
    const prompts = generateRetrievalPrompts({
      objectives: [{ id: "obj_1", title: "Loops" }],
      target_outcome: { prompt_count: 15 },
      topic_scope: "L3–L4",
    });
    expect(prompts).toHaveLength(15);
  });

  it("defaults to 10 prompts when prompt_count is not set", () => {
    const prompts = generateRetrievalPrompts({
      objectives: [{ id: "obj_1", title: "Loops" }],
      target_outcome: null,
      topic_scope: "L3–L4",
    });
    expect(prompts).toHaveLength(10);
  });

  it("distributes prompts evenly across objectives", () => {
    const prompts = generateRetrievalPrompts({
      objectives: [
        { id: "obj_1", title: "Loops" },
        { id: "obj_2", title: "Arrays" },
      ],
      target_outcome: { prompt_count: 6 },
      topic_scope: "L3–L4",
    });
    expect(prompts).toHaveLength(6);
    const obj1Count = prompts.filter((p) => p.objective_id === "obj_1").length;
    const obj2Count = prompts.filter((p) => p.objective_id === "obj_2").length;
    expect(obj1Count).toBe(3);
    expect(obj2Count).toBe(3);
  });

  it("falls back to topic_scope when no objectives provided", () => {
    const prompts = generateRetrievalPrompts({
      objectives: null,
      target_outcome: { prompt_count: 3 },
      topic_scope: "Ch 5 Buffers",
    });
    expect(prompts).toHaveLength(3);
    expect(prompts[0].text).toContain("Ch 5 Buffers");
  });

  it("generates prompts with unique ids", () => {
    const prompts = generateRetrievalPrompts({
      objectives: [{ id: "obj_1", title: "X" }],
      target_outcome: { prompt_count: 20 },
      topic_scope: "T",
    });
    const ids = new Set(prompts.map((p) => p.id));
    expect(ids.size).toBe(20);
  });

  it("rotates through prompt variants", () => {
    const prompts = generateRetrievalPrompts({
      objectives: [{ id: "obj_1", title: "Recursion" }],
      target_outcome: { prompt_count: 6 },
      topic_scope: "T",
    });
    // First prompt should start with "From memory"
    expect(prompts[0].text).toMatch(/^From memory/);
    // Second should start with "Define"
    expect(prompts[1].text).toMatch(/^Define/);
    // They should not all be the same
    const uniqueTexts = new Set(prompts.map((p) => p.text));
    expect(uniqueTexts.size).toBe(6);
  });
});

describe("shuffleMcqChoices", () => {
  const mcq: Prompt = {
    id: "p_0",
    text: "Which process moves water across a membrane?",
    difficulty: 2,
    format: "MCQ",
    choices: ["Osmosis", "Active transport", "Endocytosis", "Phagocytosis"],
    correctIndex: 0,
    meta: { distractorRationales: ["r0", "r1", "r2", "r3"] },
  };

  it("keeps correctIndex pointing at the correct choice after shuffling", () => {
    const shuffled = shuffleMcqChoices(mcq, "seed-a");
    expect(shuffled.choices).toHaveLength(4);
    expect(shuffled.choices![shuffled.correctIndex!]).toBe("Osmosis");
  });

  it("keeps rationales aligned with their choices after shuffling", () => {
    const shuffled = shuffleMcqChoices(mcq, "seed-b");
    const originalPairs = new Map(mcq.choices!.map((c, i) => [c, mcq.meta!.distractorRationales![i]]));
    shuffled.choices!.forEach((c, i) => {
      expect(shuffled.meta!.distractorRationales![i]).toBe(originalPairs.get(c));
    });
  });

  it("is deterministic for the same seed", () => {
    const a = shuffleMcqChoices(mcq, "seed-c");
    const b = shuffleMcqChoices(mcq, "seed-c");
    expect(a.choices).toEqual(b.choices);
    expect(a.correctIndex).toBe(b.correctIndex);
  });

  it("refuses to shuffle an out-of-range correctIndex (would become -1)", () => {
    const bad = { ...mcq, correctIndex: 4 };
    const result = shuffleMcqChoices(bad, "seed-d");
    expect(result).toBe(bad);
    expect(result.correctIndex).toBe(4);
  });

  it("drops misaligned rationales instead of misattributing them", () => {
    const shortRationales = { ...mcq, meta: { distractorRationales: ["r0", "r1", "r2"] } };
    const shuffled = shuffleMcqChoices(shortRationales, "seed-e");
    expect(shuffled.meta?.distractorRationales).toBeUndefined();
  });

  it("returns non-MCQ prompts unchanged", () => {
    const freeRecall: Prompt = { id: "p_1", text: "Explain osmosis", difficulty: 1 };
    expect(shuffleMcqChoices(freeRecall, "seed-f")).toBe(freeRecall);
  });
});
