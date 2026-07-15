import { describe, it, expect } from "vitest";
import { submitAttemptSchema, updateAttemptMetaSchema } from "@/lib/validation";

describe("submitAttemptSchema", () => {
  it("accepts a valid CORRECT attempt without error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Some answer",
      self_score: "CORRECT",
      time_to_answer_seconds: 30,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid INCORRECT attempt with error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 1,
      user_answer: "Wrong answer",
      self_score: "INCORRECT",
      time_to_answer_seconds: 45,
      error_log: {
        error_type: "MISCONCEPTION",
        correction_rule: "The correct approach is...",
      },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a valid PARTIAL attempt with error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 2,
      user_answer: "Partial answer",
      self_score: "PARTIAL",
      error_log: {
        error_type: "MEMORY",
        correction_rule: "I forgot that...",
        variant_question: "What if we also consider...?",
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects PARTIAL without error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Partial answer",
      self_score: "PARTIAL",
    });
    expect(result.success).toBe(false);
  });

  it("rejects INCORRECT without error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Wrong",
      self_score: "INCORRECT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty user_answer", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "",
      self_score: "CORRECT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative prompt_index", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: -1,
      user_answer: "Answer",
      self_score: "CORRECT",
    });
    expect(result.success).toBe(false);
  });

  it("rejects time_to_answer_seconds > 7200", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Answer",
      self_score: "CORRECT",
      time_to_answer_seconds: 7201,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid self_score", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Answer",
      self_score: "WRONG_VALUE",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid error_type in error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Answer",
      self_score: "INCORRECT",
      error_log: {
        error_type: "INVALID_TYPE",
        correction_rule: "Something",
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty correction_rule in error_log", () => {
    const result = submitAttemptSchema.safeParse({
      prompt_index: 0,
      user_answer: "Answer",
      self_score: "INCORRECT",
      error_log: {
        error_type: "MEMORY",
        correction_rule: "",
      },
    });
    expect(result.success).toBe(false);
  });

  // MCQ attempts: the server grades the choice and builds the error log,
  // so neither self_score nor error_log is required from the client.
  describe("MCQ attempts", () => {
    it("accepts an MCQ attempt with only mcq_choice_index (no self_score, no error_log)", () => {
      const result = submitAttemptSchema.safeParse({
        prompt_index: 3,
        user_answer: "[B] Osmosis",
        mcq_choice_index: 1,
        time_to_answer_seconds: 12,
      });
      expect(result.success).toBe(true);
    });

    it("rejects an attempt with neither self_score nor mcq_choice_index", () => {
      const result = submitAttemptSchema.safeParse({
        prompt_index: 0,
        user_answer: "Answer",
      });
      expect(result.success).toBe(false);
    });

    it("rejects mcq_choice_index outside 0-3", () => {
      expect(
        submitAttemptSchema.safeParse({
          prompt_index: 0,
          user_answer: "[E] Nope",
          mcq_choice_index: 4,
        }).success
      ).toBe(false);
      expect(
        submitAttemptSchema.safeParse({
          prompt_index: 0,
          user_answer: "[?] Nope",
          mcq_choice_index: -1,
        }).success
      ).toBe(false);
    });
  });
});

describe("updateAttemptMetaSchema", () => {
  it("accepts a self_explanation-only update", () => {
    expect(
      updateAttemptMetaSchema.safeParse({ self_explanation: "Because X implies Y" }).success
    ).toBe(true);
  });

  it("accepts a generated_example-only update", () => {
    expect(
      updateAttemptMetaSchema.safeParse({ generated_example: "A new scenario..." }).success
    ).toBe(true);
  });

  it("rejects an empty update", () => {
    expect(updateAttemptMetaSchema.safeParse({}).success).toBe(false);
  });

  it("rejects oversized fields", () => {
    expect(
      updateAttemptMetaSchema.safeParse({ self_explanation: "x".repeat(2001) }).success
    ).toBe(false);
  });
});
