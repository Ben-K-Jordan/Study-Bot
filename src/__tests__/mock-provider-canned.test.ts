/**
 * Unit tests for the MockProvider canned GENERATE_PROMPTS / GENERATE_FEEDBACK /
 * GENERATE_WORKED_EXAMPLES responses, and the test-only malformed elicitation
 * (env var MOCK_AI_MALFORMED=1 or the __ELICIT_MALFORMED__ input marker).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockProvider, MALFORMED_MARKER } from "@/lib/ai/providers/mock";

const PROMPTS_SYS = "You are a professor. Task: GENERATE_PROMPTS.";
const FEEDBACK_SYS = "You are a professor. Task: GENERATE_FEEDBACK.";
const WORKED_SYS = "You are a professor. Task: GENERATE_WORKED_EXAMPLES.";

interface MockPrompt {
  objective_id?: unknown;
  text?: unknown;
  format?: string;
  choices?: unknown;
  correct_index?: unknown;
  distractor_rationales?: unknown;
  model_answer?: unknown;
  key_points?: unknown;
}

interface MockSet {
  problem?: unknown;
  steps?: { action?: unknown; why?: unknown }[];
  completion_problem_1?: unknown;
  completion_problem_2?: unknown;
  full_problem?: unknown;
  model_answer?: unknown;
}

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === "string" && v.trim().length > 0;

describe("MockProvider canned AI responses", () => {
  let provider: MockProvider;
  const prevEnv = process.env.MOCK_AI_MALFORMED;

  beforeEach(() => {
    provider = new MockProvider();
    delete process.env.MOCK_AI_MALFORMED;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.MOCK_AI_MALFORMED;
    else process.env.MOCK_AI_MALFORMED = prevEnv;
  });

  it("GENERATE_PROMPTS default: at least 3 valid prompts, MCQs well-formed", async () => {
    const result = await provider.completeJson(PROMPTS_SYS, "generate questions", "m");
    const prompts = (result.json as { prompts: MockPrompt[] }).prompts;

    expect(prompts.length).toBeGreaterThanOrEqual(3);
    for (const p of prompts) {
      expect(isNonEmptyString(p.text)).toBe(true);
      expect(typeof p.objective_id).toBe("string");
      expect(isNonEmptyString(p.model_answer)).toBe(true);
      expect(Array.isArray(p.key_points)).toBe(true);
      expect((p.key_points as unknown[]).every((k) => isNonEmptyString(k))).toBe(true);
      if (p.format === "MCQ") {
        expect(Array.isArray(p.choices)).toBe(true);
        expect(p.choices as unknown[]).toHaveLength(4);
        expect(Number.isInteger(p.correct_index)).toBe(true);
        expect(p.correct_index as number).toBeGreaterThanOrEqual(0);
        expect(p.correct_index as number).toBeLessThan(4);
        expect(p.distractor_rationales as unknown[]).toHaveLength(4);
      }
    }
    // At least one MCQ and one FREE_RECALL in the canned deck
    expect(prompts.some((p) => p.format === "MCQ")).toBe(true);
    expect(prompts.some((p) => p.format === "FREE_RECALL")).toBe(true);
  });

  it("GENERATE_FEEDBACK default: all fields are strings", async () => {
    const result = await provider.completeJson(FEEDBACK_SYS, "give feedback", "m");
    const json = result.json as Record<string, unknown>;

    expect(isNonEmptyString(json.explanation)).toBe(true);
    expect(isNonEmptyString(json.key_takeaway)).toBe(true);
    expect(isNonEmptyString(json.concept_connection)).toBe(true);
    expect(isNonEmptyString(json.mnemonic)).toBe(true);
    expect(isNonEmptyString(json.pattern_advice)).toBe(true);
    expect(Array.isArray(json.referenced_chunk_ids)).toBe(true);
  });

  it("GENERATE_WORKED_EXAMPLES default: sets satisfy the deck validity rules", async () => {
    const result = await provider.completeJson(WORKED_SYS, "generate sets", "m");
    const sets = (result.json as { sets: MockSet[] }).sets;

    expect(sets.length).toBeGreaterThanOrEqual(1);
    for (const s of sets) {
      expect(isNonEmptyString(s.problem)).toBe(true);
      expect(Array.isArray(s.steps)).toBe(true);
      expect(s.steps!.length).toBeGreaterThanOrEqual(2);
      for (const step of s.steps!) {
        expect(isNonEmptyString(step.action)).toBe(true);
        expect(isNonEmptyString(step.why)).toBe(true);
      }
      expect(isNonEmptyString(s.completion_problem_1)).toBe(true);
      expect(isNonEmptyString(s.completion_problem_2)).toBe(true);
      expect(isNonEmptyString(s.full_problem)).toBe(true);
      expect(isNonEmptyString(s.model_answer)).toBe(true);
    }
  });

  it("input marker elicits malformed GENERATE_PROMPTS (fewer than 3 valid survive)", async () => {
    const result = await provider.completeJson(
      PROMPTS_SYS,
      `topic ${MALFORMED_MARKER}`,
      "m",
    );
    const prompts = (result.json as { prompts: MockPrompt[] }).prompts;

    const valid = prompts.filter(
      (p) => isNonEmptyString(p.text) && typeof p.objective_id === "string",
    );
    expect(valid.length).toBeLessThan(3);
    expect(prompts.length).toBeGreaterThan(valid.length);
    // Includes an off-by-one MCQ that must be demoted, not scored
    expect(
      prompts.some(
        (p) =>
          p.format === "MCQ" &&
          Array.isArray(p.choices) &&
          (p.correct_index as number) >= (p.choices as unknown[]).length,
      ),
    ).toBe(true);
  });

  it("env var elicits malformed GENERATE_FEEDBACK (no string fields)", async () => {
    process.env.MOCK_AI_MALFORMED = "1";
    const result = await provider.completeJson(FEEDBACK_SYS, "give feedback", "m");
    const json = result.json as Record<string, unknown>;

    expect(typeof json.explanation).not.toBe("string");
    expect(typeof json.key_takeaway).not.toBe("string");
    expect(typeof json.mnemonic).not.toBe("string");
    expect(Array.isArray(json.referenced_chunk_ids)).toBe(false);
  });

  it("env var elicits malformed GENERATE_WORKED_EXAMPLES (every set invalid)", async () => {
    process.env.MOCK_AI_MALFORMED = "1";
    const result = await provider.completeJson(WORKED_SYS, "generate sets", "m");
    const sets = (result.json as { sets: MockSet[] }).sets;

    expect(sets.length).toBeGreaterThan(0);
    const validSets = sets.filter(
      (s) =>
        isNonEmptyString(s.problem) &&
        Array.isArray(s.steps) &&
        s.steps.length >= 2 &&
        s.steps.every((st) => isNonEmptyString(st?.action) && isNonEmptyString(st?.why)) &&
        isNonEmptyString(s.completion_problem_1) &&
        isNonEmptyString(s.completion_problem_2) &&
        isNonEmptyString(s.full_problem) &&
        isNonEmptyString(s.model_answer),
    );
    expect(validSets).toHaveLength(0);
  });

  it("leaves other canned tasks untouched", async () => {
    const citations = await provider.completeJson(
      "Task: ANSWER_WITH_CITATIONS.",
      "question",
      "m",
    );
    expect((citations.json as Record<string, unknown>).answer_markdown).toBeTruthy();

    const fallback = await provider.completeJson("Task: SOMETHING_ELSE.", "x", "m");
    expect(fallback.json).toEqual({ text: "Mock response" });
  });
});
