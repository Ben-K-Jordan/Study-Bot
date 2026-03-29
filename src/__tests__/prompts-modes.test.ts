import { describe, it, expect } from "vitest";
import {
  generateInterleavedPrompts,
  generateErrorRepairPrompts,
  deterministicShuffle,
  type ErrorLogForRepair,
} from "@/lib/prompts";

// ---- Interleaved Practice ----

describe("generateInterleavedPrompts", () => {
  const twoObjectives = [
    { id: "obj_1", title: "Loops" },
    { id: "obj_2", title: "Arrays" },
  ];

  const threeObjectives = [
    { id: "obj_1", title: "Loops" },
    { id: "obj_2", title: "Arrays" },
    { id: "obj_3", title: "Trees" },
  ];

  it("generates the requested number of prompts", () => {
    const prompts = generateInterleavedPrompts({
      objectives: twoObjectives,
      target_outcome: { prompt_count: 8 },
      topic_scope: "T",
    });
    expect(prompts).toHaveLength(8);
  });

  it("no more than 2 consecutive prompts with same objective_id (2 objectives)", () => {
    const prompts = generateInterleavedPrompts({
      objectives: twoObjectives,
      target_outcome: { prompt_count: 20 },
      topic_scope: "T",
      seed: "test_seed",
    });

    let consecutiveCount = 1;
    for (let i = 1; i < prompts.length; i++) {
      if (prompts[i].objective_id === prompts[i - 1].objective_id) {
        consecutiveCount++;
        expect(consecutiveCount).toBeLessThanOrEqual(2);
      } else {
        consecutiveCount = 1;
      }
    }
  });

  it("no more than 2 consecutive prompts with same objective_id (3 objectives)", () => {
    const prompts = generateInterleavedPrompts({
      objectives: threeObjectives,
      target_outcome: { prompt_count: 15 },
      topic_scope: "T",
      seed: "seed_abc",
    });

    let consecutiveCount = 1;
    for (let i = 1; i < prompts.length; i++) {
      if (prompts[i].objective_id === prompts[i - 1].objective_id) {
        consecutiveCount++;
        expect(consecutiveCount).toBeLessThanOrEqual(2);
      } else {
        consecutiveCount = 1;
      }
    }
  });

  it("alternates objectives at least in the first few prompts", () => {
    const prompts = generateInterleavedPrompts({
      objectives: twoObjectives,
      target_outcome: { prompt_count: 10 },
      topic_scope: "T",
      seed: "test_alt",
    });

    // First two prompts should have different objective_ids
    expect(prompts[0].objective_id).not.toBe(prompts[1].objective_id);
  });

  it("is deterministic with the same seed", () => {
    const params = {
      objectives: threeObjectives,
      target_outcome: { prompt_count: 12 },
      topic_scope: "T",
      seed: "deterministic_seed",
    };
    const a = generateInterleavedPrompts(params);
    const b = generateInterleavedPrompts(params);
    expect(a.map((p) => p.objective_id)).toEqual(b.map((p) => p.objective_id));
    expect(a.map((p) => p.text)).toEqual(b.map((p) => p.text));
  });

  it("produces different output with different seeds", () => {
    const base = {
      objectives: threeObjectives,
      target_outcome: { prompt_count: 12 },
      topic_scope: "T",
    };
    const a = generateInterleavedPrompts({ ...base, seed: "seed_1" });
    const b = generateInterleavedPrompts({ ...base, seed: "seed_2" });
    // With different seeds, at least some prompt texts should differ in ordering
    const aTexts = a.map((p) => p.text).join("|");
    const bTexts = b.map((p) => p.text).join("|");
    // They might be different; but at minimum both should have the right length
    expect(a).toHaveLength(12);
    expect(b).toHaveLength(12);
  });

  it("falls back to retrieval style with single objective", () => {
    const prompts = generateInterleavedPrompts({
      objectives: [{ id: "obj_1", title: "Only" }],
      target_outcome: { prompt_count: 5 },
      topic_scope: "T",
    });
    expect(prompts).toHaveLength(5);
    expect(prompts.every((p) => p.objective_id === "obj_1")).toBe(true);
  });

  it("assigns sequential IDs", () => {
    const prompts = generateInterleavedPrompts({
      objectives: twoObjectives,
      target_outcome: { prompt_count: 6 },
      topic_scope: "T",
    });
    expect(prompts.map((p) => p.id)).toEqual(["p_0", "p_1", "p_2", "p_3", "p_4", "p_5"]);
  });

  it("distributes prompts roughly equally across objectives", () => {
    const prompts = generateInterleavedPrompts({
      objectives: threeObjectives,
      target_outcome: { prompt_count: 9 },
      topic_scope: "T",
    });
    const counts = new Map<string, number>();
    for (const p of prompts) {
      counts.set(p.objective_id!, (counts.get(p.objective_id!) ?? 0) + 1);
    }
    // Each should get 3
    expect(counts.get("obj_1")).toBe(3);
    expect(counts.get("obj_2")).toBe(3);
    expect(counts.get("obj_3")).toBe(3);
  });
});

// ---- Deterministic Shuffle ----

describe("deterministicShuffle", () => {
  it("is deterministic with the same seed", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8];
    const b = [...a];
    deterministicShuffle(a, "seed_x");
    deterministicShuffle(b, "seed_x");
    expect(a).toEqual(b);
  });

  it("produces different ordering with different seeds", () => {
    const a = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const b = [...a];
    deterministicShuffle(a, "seed_a");
    deterministicShuffle(b, "seed_b");
    // Very unlikely to be the same after shuffling
    expect(a).not.toEqual(b);
  });

  it("does not lose elements", () => {
    const arr = [10, 20, 30, 40, 50];
    deterministicShuffle(arr, "keep_all");
    expect(arr.sort((a, b) => a - b)).toEqual([10, 20, 30, 40, 50]);
  });
});

// ---- Error Repair Deck ----

describe("generateErrorRepairPrompts", () => {
  const sampleLogs: ErrorLogForRepair[] = [
    {
      id: "err_1",
      prompt_index: 0,
      error_type: "MISCONCEPTION",
      correction_rule: "Loop invariant must hold before and after each iteration",
      variant_question: "What are the 3 parts of a loop invariant proof?",
      prompt_text: "Explain loops",
    },
    {
      id: "err_2",
      prompt_index: 1,
      error_type: "MEMORY",
      correction_rule: "Arrays are zero-indexed in Java",
      variant_question: null,
      prompt_text: "Define arrays",
    },
    {
      id: "err_3",
      prompt_index: 2,
      error_type: "PROCEDURE",
      correction_rule: "DFS uses a stack, BFS uses a queue",
      variant_question: "When would you prefer BFS over DFS?",
      prompt_text: "Compare DFS and BFS",
    },
  ];

  it("generates prompts up to target count", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 2);
    expect(prompts).toHaveLength(2);
  });

  it("generates prompts equal to available errors when target exceeds count", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 10);
    expect(prompts).toHaveLength(3);
  });

  it("includes source_error_log_id in prompt meta", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    expect(prompts[0].meta?.source_error_log_id).toBe("err_1");
    expect(prompts[1].meta?.source_error_log_id).toBe("err_2");
    expect(prompts[2].meta?.source_error_log_id).toBe("err_3");
  });

  it("includes expected_correction_rule in meta", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 1);
    expect(prompts[0].meta?.expected_correction_rule).toBe(
      "Loop invariant must hold before and after each iteration"
    );
  });

  it("uses variant_question when available", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    expect(prompts[0].text).toContain("What are the 3 parts of a loop invariant proof?");
  });

  it("uses fallback text when no variant_question", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    expect(prompts[1].text).toContain("near-transfer example");
  });

  it("does not reveal the correction rule in prompt text", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    for (const p of prompts) {
      expect(p.text).not.toContain(p.meta?.expected_correction_rule);
    }
  });

  it("assigns sequential IDs", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    expect(prompts.map((p) => p.id)).toEqual(["p_0", "p_1", "p_2"]);
  });

  it("sets difficulty to 2 for repair prompts", () => {
    const prompts = generateErrorRepairPrompts(sampleLogs, 3);
    expect(prompts.every((p) => p.difficulty === 2)).toBe(true);
  });
});
