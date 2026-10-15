import { describe, it, expect } from "vitest";
import {
  answerFit,
  confidenceLevel,
  MIN_RATED,
  summarizeCalibration,
} from "@/components/session/calibration";
import type { RatedAnswer, SelfScore } from "@/components/session/types";

function answer(index: number, confidence: number | null, score: SelfScore): RatedAnswer {
  return { prompt_index: index, confidence, score };
}

describe("confidenceLevel", () => {
  it("reads the one scale stored as 1, 3 and 5", () => {
    expect(confidenceLevel(1)).toBe("guessing");
    expect(confidenceLevel(3)).toBe("unsure");
    expect(confidenceLevel(5)).toBe("sure");
  });

  it("maps the older five-step values to the nearest level", () => {
    expect(confidenceLevel(2)).toBe("unsure");
    expect(confidenceLevel(4)).toBe("sure");
  });

  it("treats missing and out-of-range values as not rated", () => {
    expect(confidenceLevel(null)).toBeNull();
    expect(confidenceLevel(undefined)).toBeNull();
    expect(confidenceLevel(0)).toBeNull();
    expect(confidenceLevel(6)).toBeNull();
    expect(confidenceLevel(Number.NaN)).toBeNull();
  });
});

describe("answerFit", () => {
  it("never flags Unsure, whatever the result", () => {
    expect(answerFit("unsure", "CORRECT")).toBe("matched");
    expect(answerFit("unsure", "PARTIAL")).toBe("matched");
    expect(answerFit("unsure", "INCORRECT")).toBe("matched");
  });

  it("calls Sure on an answer that wasn't fully correct overconfident", () => {
    expect(answerFit("sure", "CORRECT")).toBe("matched");
    expect(answerFit("sure", "PARTIAL")).toBe("overconfident");
    expect(answerFit("sure", "INCORRECT")).toBe("overconfident");
  });

  it("does not call a single right guess underconfident", () => {
    expect(answerFit("guessing", "CORRECT")).toBe("guessed-right");
    expect(answerFit("guessing", "INCORRECT")).toBe("matched");
    expect(answerFit("guessing", "PARTIAL")).toBe("matched");
  });
});

describe("summarizeCalibration", () => {
  it("gives no summary below the minimum number of rated answers", () => {
    const summary = summarizeCalibration([answer(0, 5, "INCORRECT"), answer(1, null, "CORRECT")]);
    expect(MIN_RATED).toBeGreaterThan(1);
    expect(summary.rated).toBe(1);
    expect(summary.unrated).toBe(1);
    expect(summary.enough).toBe(false);
  });

  it("counts matches, overconfident answers and per-level correct rates", () => {
    const summary = summarizeCalibration([
      answer(0, 5, "CORRECT"),
      answer(1, 5, "INCORRECT"),
      answer(2, 5, "PARTIAL"),
      answer(3, 3, "INCORRECT"),
      answer(4, 1, "INCORRECT"),
      answer(5, null, "CORRECT"),
    ]);
    expect(summary.enough).toBe(true);
    expect(summary.rated).toBe(5);
    expect(summary.unrated).toBe(1);
    expect(summary.matched).toBe(3);
    expect(summary.overconfident).toBe(2);
    expect(summary.overconfidentQuestions).toEqual([1, 2]);
    expect(summary.underconfident).toBe(0);

    const sure = summary.levels.find((l) => l.level === "sure")!;
    expect(sure).toMatchObject({ count: 3, correct: 1, partial: 1, incorrect: 1 });
    expect(sure.correctRate).toBeCloseTo(1 / 3);
    const unsure = summary.levels.find((l) => l.level === "unsure")!;
    expect(unsure.correctRate).toBe(0);
  });

  it("leaves an unused level without a rate", () => {
    const summary = summarizeCalibration([answer(0, 5, "CORRECT"), answer(1, 5, "CORRECT"), answer(2, 3, "CORRECT")]);
    expect(summary.levels.find((l) => l.level === "guessing")!.correctRate).toBeNull();
  });

  it("does not report one or two right guesses as underconfidence", () => {
    const summary = summarizeCalibration([
      answer(0, 1, "CORRECT"),
      answer(1, 1, "INCORRECT"),
      answer(2, 5, "CORRECT"),
    ]);
    expect(summary.guessedRight).toBe(1);
    expect(summary.underconfident).toBe(0);
    expect(summary.matched).toBe(2);
  });

  it("reports underconfidence when right guesses form a pattern", () => {
    const summary = summarizeCalibration([
      answer(0, 1, "CORRECT"),
      answer(1, 1, "CORRECT"),
      answer(2, 1, "INCORRECT"),
      answer(3, 5, "CORRECT"),
    ]);
    expect(summary.guessedRight).toBe(2);
    expect(summary.underconfident).toBe(2);
  });

  it("keeps guesses below half right out of the underconfident count", () => {
    const summary = summarizeCalibration([
      answer(0, 1, "CORRECT"),
      answer(1, 1, "INCORRECT"),
      answer(2, 1, "INCORRECT"),
      answer(3, 1, "INCORRECT"),
    ]);
    expect(summary.underconfident).toBe(0);
  });
});
