import { describe, it, expect } from "vitest";
import { submitAttemptSchema } from "@/lib/validation";

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
});
