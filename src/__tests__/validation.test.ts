import { describe, it, expect } from "vitest";
import { MAX_PROMPT_COUNT, clampPromptCount, createSessionSchema } from "@/lib/validation";

const validPayload = {
  course_id: "CS2110",
  course_name: "CS 2110",
  exam_id: "prelim1",
  exam_name: "Prelim 1",
  mode: "RETRIEVAL" as const,
  topic_scope: "L3–L4",
  planned_minutes: 80,
};

describe("createSessionSchema", () => {
  it("accepts a valid payload", () => {
    const result = createSessionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects missing course_name", () => {
    const { course_name, ...rest } = validPayload;
    const result = createSessionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects invalid mode", () => {
    const result = createSessionSchema.safeParse({
      ...validPayload,
      mode: "INVALID",
    });
    expect(result.success).toBe(false);
  });

  it("rejects planned_minutes < 15", () => {
    const result = createSessionSchema.safeParse({
      ...validPayload,
      planned_minutes: 10,
    });
    expect(result.success).toBe(false);
  });

  it("rejects planned_minutes > 240", () => {
    const result = createSessionSchema.safeParse({
      ...validPayload,
      planned_minutes: 300,
    });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields", () => {
    const result = createSessionSchema.safeParse({
      ...validPayload,
      objectives: [{ id: "obj_1", title: "Loops" }],
      target_outcome: {
        type: "accuracy",
        prompt_count: 20,
        target_accuracy: 0.8,
        closed_book_required: true,
        deliverables: ["error_log_entries>=5"],
      },
      break_protocol: { type: "50_10", cycles: 1 },
      resources: [{ type: "slides", ref: "week2.pdf", range: "pp. 1-10" }],
    });
    expect(result.success).toBe(true);
  });
  // The run builds the whole deck in memory, so an unbounded count could
  // take the shared server down; 0 or less left a run with no questions.
  it("takes 1 to 60 whole questions", () => {
    const withCount = (prompt_count: number) =>
      createSessionSchema.safeParse({ ...validPayload, target_outcome: { prompt_count } }).success;
    expect(withCount(1)).toBe(true);
    expect(withCount(MAX_PROMPT_COUNT)).toBe(true);
    for (const bad of [0, -3, 2.5, MAX_PROMPT_COUNT + 1, 50_000_000, 1e308]) {
      expect(withCount(bad), String(bad)).toBe(false);
    }
  });

  it("bounds the free-form fields", () => {
    const tooLong = (field: string, length: number) =>
      createSessionSchema.safeParse({ ...validPayload, [field]: "x".repeat(length) }).success;
    expect(tooLong("course_name", 200)).toBe(true);
    expect(tooLong("course_name", 201)).toBe(false);
    expect(tooLong("exam_name", 201)).toBe(false);
    expect(tooLong("topic_scope", 2001)).toBe(false);

    const objectives = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `obj_${i}`, title: `Topic ${i}` }));
    expect(createSessionSchema.safeParse({ ...validPayload, objectives: objectives(50) }).success).toBe(true);
    expect(createSessionSchema.safeParse({ ...validPayload, objectives: objectives(51) }).success).toBe(false);
    expect(
      createSessionSchema.safeParse({ ...validPayload, objectives: [{ id: "a", title: "x".repeat(501) }] }).success,
    ).toBe(false);

    const resources = Array.from({ length: 21 }, () => ({ type: "slides", ref: "week2.pdf" }));
    expect(createSessionSchema.safeParse({ ...validPayload, resources }).success).toBe(false);
  });
});

describe("clampPromptCount", () => {
  it("keeps a stored count between 1 and the maximum", () => {
    expect(clampPromptCount(8)).toBe(8);
    expect(clampPromptCount(50_000_000)).toBe(MAX_PROMPT_COUNT);
    expect(clampPromptCount(1e308)).toBe(MAX_PROMPT_COUNT);
    expect(clampPromptCount(0)).toBe(1);
    expect(clampPromptCount(-4)).toBe(1);
    expect(clampPromptCount(7.9)).toBe(7);
  });

  it("falls back when the count is missing or not a number", () => {
    expect(clampPromptCount(undefined)).toBe(10);
    expect(clampPromptCount(null)).toBe(10);
    expect(clampPromptCount("12")).toBe(10);
    expect(clampPromptCount(Number.NaN)).toBe(10);
    expect(clampPromptCount(Number.POSITIVE_INFINITY)).toBe(10);
    expect(clampPromptCount(undefined, 3)).toBe(3);
  });
});

