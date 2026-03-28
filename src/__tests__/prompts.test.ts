import { describe, it, expect } from "vitest";
import { generateRetrievalPrompts } from "@/lib/prompts";

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
