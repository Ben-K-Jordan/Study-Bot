import { describe, it, expect } from "vitest";
import {
  parseAttemptPayload,
  examAnswerSchema,
  examScoreSchema,
} from "@/lib/validation";

describe("parseAttemptPayload", () => {
  it("parses legacy payload (no kind field)", () => {
    const result = parseAttemptPayload({
      prompt_index: 0,
      user_answer: "my answer",
      self_score: "CORRECT",
      time_to_answer_seconds: 30,
    });
    expect(result.prompt_index).toBe(0);
    expect("self_score" in result && result.self_score).toBe("CORRECT");
  });

  it("parses ANSWER kind payload", () => {
    const result = parseAttemptPayload({
      prompt_index: 2,
      kind: "ANSWER",
      user_answer: "exam answer",
      time_to_answer_seconds: 45,
    });
    expect("kind" in result && result.kind).toBe("ANSWER");
    expect("user_answer" in result && result.user_answer).toBe("exam answer");
  });

  it("parses SCORE kind payload with CORRECT", () => {
    const result = parseAttemptPayload({
      prompt_index: 0,
      kind: "SCORE",
      self_score: "CORRECT",
    });
    expect("kind" in result && result.kind).toBe("SCORE");
    expect("self_score" in result && result.self_score).toBe("CORRECT");
  });

  it("parses SCORE kind with error_log for INCORRECT", () => {
    const result = parseAttemptPayload({
      prompt_index: 1,
      kind: "SCORE",
      self_score: "INCORRECT",
      error_log: {
        error_type: "MEMORY",
        correction_rule: "Remember this rule",
      },
    });
    expect("kind" in result && result.kind).toBe("SCORE");
    expect("error_log" in result && result.error_log).toBeDefined();
  });

  it("rejects SCORE without error_log when PARTIAL", () => {
    expect(() =>
      parseAttemptPayload({
        prompt_index: 0,
        kind: "SCORE",
        self_score: "PARTIAL",
      })
    ).toThrow();
  });

  it("rejects legacy payload without self_score", () => {
    expect(() =>
      parseAttemptPayload({
        prompt_index: 0,
        user_answer: "test",
      })
    ).toThrow();
  });

  it("rejects ANSWER kind without user_answer", () => {
    expect(() =>
      parseAttemptPayload({
        prompt_index: 0,
        kind: "ANSWER",
      })
    ).toThrow();
  });
});

describe("examAnswerSchema", () => {
  it("requires user_answer", () => {
    expect(() =>
      examAnswerSchema.parse({ prompt_index: 0, kind: "ANSWER" })
    ).toThrow();
  });

  it("rejects empty user_answer", () => {
    expect(() =>
      examAnswerSchema.parse({ prompt_index: 0, kind: "ANSWER", user_answer: "" })
    ).toThrow();
  });

  it("accepts valid ANSWER payload", () => {
    const result = examAnswerSchema.parse({
      prompt_index: 3,
      kind: "ANSWER",
      user_answer: "my exam answer",
    });
    expect(result.prompt_index).toBe(3);
  });
});

describe("examScoreSchema", () => {
  it("requires self_score", () => {
    expect(() =>
      examScoreSchema.parse({ prompt_index: 0, kind: "SCORE" })
    ).toThrow();
  });

  it("requires error_log when INCORRECT", () => {
    expect(() =>
      examScoreSchema.parse({ prompt_index: 0, kind: "SCORE", self_score: "INCORRECT" })
    ).toThrow();
  });

  it("accepts CORRECT without error_log", () => {
    const result = examScoreSchema.parse({
      prompt_index: 0,
      kind: "SCORE",
      self_score: "CORRECT",
    });
    expect(result.self_score).toBe("CORRECT");
  });
});
