import { describe, it, expect } from "vitest";
import { createSessionSchema } from "@/lib/validation";

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
});
