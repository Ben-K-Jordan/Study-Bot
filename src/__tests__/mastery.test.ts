/**
 * Unit tests for the SM-2 mastery engine.
 */
import { describe, it, expect } from "vitest";
import { accuracyToQuality, confidenceAdjustedQuality, sm2Next, type SM2State } from "@/lib/mastery";
import { compressIntervalForExam } from "@/lib/spacing";

describe("accuracyToQuality", () => {
  it("maps high accuracy to quality 5", () => {
    expect(accuracyToQuality(1.0)).toBe(5);
    expect(accuracyToQuality(0.95)).toBe(5);
    expect(accuracyToQuality(0.9)).toBe(5);
  });

  it("maps accuracy ranges correctly", () => {
    expect(accuracyToQuality(0.85)).toBe(4);
    expect(accuracyToQuality(0.8)).toBe(4);
    expect(accuracyToQuality(0.75)).toBe(3);
    expect(accuracyToQuality(0.7)).toBe(3);
    expect(accuracyToQuality(0.6)).toBe(2);
    expect(accuracyToQuality(0.5)).toBe(2);
    expect(accuracyToQuality(0.4)).toBe(1);
    expect(accuracyToQuality(0.3)).toBe(1);
    expect(accuracyToQuality(0.2)).toBe(0);
    expect(accuracyToQuality(0.0)).toBe(0);
  });
});

describe("confidenceAdjustedQuality", () => {
  it("returns base quality when confidence is null", () => {
    expect(confidenceAdjustedQuality(4, 0.8, null)).toBe(4);
  });

  it("leaves well-calibrated answers unchanged", () => {
    expect(confidenceAdjustedQuality(5, 0.95, 5)).toBe(5);
    expect(confidenceAdjustedQuality(2, 0.6, 3)).toBe(2);
  });

  it("penalizes blind spots (confident but wrong)", () => {
    // accuracy 0.4 → quality 1; confidence 4/5 → normalized 0.75
    expect(confidenceAdjustedQuality(1, 0.4, 4)).toBe(0);
  });

  it("slows advancement for fragile knowledge (right but unsure)", () => {
    // accuracy 0.9 → quality 5; confidence 1/5 → normalized 0
    expect(confidenceAdjustedQuality(5, 0.9, 1)).toBe(4);
    expect(confidenceAdjustedQuality(4, 0.8, 1)).toBe(3);
  });

  it("never drops fragile knowledge below the passing grade of 3", () => {
    // Regression: accuracy 0.75 → base quality 3, the minimum passing grade
    // in sm2Next. A correct-but-unsure answer must stay at 3 — dropping to 2
    // would reset repetitions and interval, wiping out spacing progress.
    expect(confidenceAdjustedQuality(3, 0.75, 1)).toBe(3);
    expect(confidenceAdjustedQuality(3, 0.7, 2)).toBe(3);
  });
});

describe("sm2Next", () => {
  const now = new Date("2025-01-15T12:00:00Z");

  const freshState: SM2State = {
    easeFactor: 2.5,
    intervalDays: 0,
    repetitions: 0,
  };

  it("sets interval to 1 day on first correct answer", () => {
    const result = sm2Next(freshState, 4, now);
    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(1);
    expect(result.nextDueAt).toEqual(new Date("2025-01-16T12:00:00Z"));
  });

  it("sets interval to 6 days on second correct answer", () => {
    const afterFirst = sm2Next(freshState, 4, now);
    const result = sm2Next(
      { easeFactor: afterFirst.easeFactor, intervalDays: afterFirst.intervalDays, repetitions: afterFirst.repetitions },
      4,
      now,
    );
    expect(result.intervalDays).toBe(6);
    expect(result.repetitions).toBe(2);
  });

  it("multiplies interval by ease factor after third+ correct", () => {
    const state: SM2State = {
      easeFactor: 2.5,
      intervalDays: 6,
      repetitions: 2,
    };
    const result = sm2Next(state, 4, now);
    expect(result.intervalDays).toBe(15); // round(6 * 2.5)
    expect(result.repetitions).toBe(3);
  });

  it("resets on failure (quality < 3)", () => {
    const advanced: SM2State = {
      easeFactor: 2.5,
      intervalDays: 15,
      repetitions: 5,
    };
    const result = sm2Next(advanced, 2, now);
    expect(result.intervalDays).toBe(1);
    expect(result.repetitions).toBe(0);
    expect(result.nextDueAt).toEqual(new Date("2025-01-16T12:00:00Z"));
  });

  it("decreases ease factor on low quality", () => {
    const result = sm2Next(freshState, 3, now);
    expect(result.easeFactor).toBeLessThan(2.5);
    expect(result.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("increases ease factor on high quality", () => {
    const result = sm2Next(freshState, 5, now);
    expect(result.easeFactor).toBeGreaterThan(2.5);
  });

  it("never drops ease factor below 1.3", () => {
    let state: SM2State = { easeFactor: 1.3, intervalDays: 1, repetitions: 0 };
    // Repeated failures should not drop below 1.3
    for (let i = 0; i < 10; i++) {
      state = sm2Next(state, 0, now);
    }
    expect(state.easeFactor).toBeGreaterThanOrEqual(1.3);
  });

  it("total failure (quality 0) resets and penalizes ease", () => {
    const result = sm2Next(freshState, 0, now);
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
    expect(result.easeFactor).toBeLessThan(2.5);
  });
});

describe("sm2Next exam-aware compression", () => {
  // Expected intervals below were computed from the original inline
  // compression in sm2Next (before extraction to compressIntervalForExam);
  // they prove the refactor is behavior-identical.
  const now = new Date("2025-01-15T12:00:00Z");
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  // With quality 4, this state yields round(6 * 2.5) = 15 days uncompressed.
  const advanced: SM2State = { easeFactor: 2.5, intervalDays: 6, repetitions: 2 };

  it("leaves the interval uncompressed with no exam date", () => {
    expect(sm2Next(advanced, 4, now).intervalDays).toBe(15);
  });

  it("reviews daily when the exam is within 3 days", () => {
    const result = sm2Next(advanced, 4, now, daysFromNow(2));
    expect(result.intervalDays).toBe(1);
    expect(result.nextDueAt).toEqual(new Date("2025-01-16T12:00:00Z"));
  });

  it("caps at 2 days for an exam 4-7 days out", () => {
    expect(sm2Next(advanced, 4, now, daysFromNow(5)).intervalDays).toBe(2);
  });

  it("caps at 3 days for an exam 8-14 days out", () => {
    expect(sm2Next(advanced, 4, now, daysFromNow(10)).intervalDays).toBe(3);
  });

  it("caps at ~20% of remaining days for exams beyond 2 weeks", () => {
    expect(sm2Next(advanced, 4, now, daysFromNow(30)).intervalDays).toBe(6); // floor(30*0.2)
    // Far exam: cap (24) exceeds the interval, so it stays 15
    expect(sm2Next(advanced, 4, now, daysFromNow(120)).intervalDays).toBe(15);
  });

  it("never lengthens an interval shorter than the cap", () => {
    const fresh: SM2State = { easeFactor: 2.5, intervalDays: 0, repetitions: 0 };
    // First correct answer → 1 day, exam in 30 days caps at 6 → stays 1
    expect(sm2Next(fresh, 4, now, daysFromNow(30)).intervalDays).toBe(1);
  });

  it("does not change ease factor or repetitions", () => {
    const withExam = sm2Next(advanced, 4, now, daysFromNow(2));
    const without = sm2Next(advanced, 4, now);
    expect(withExam.easeFactor).toBe(without.easeFactor);
    expect(withExam.repetitions).toBe(without.repetitions);
  });

  it("still resets on failure, with the reset interval compressed no further", () => {
    const result = sm2Next(advanced, 2, now, daysFromNow(2));
    expect(result.repetitions).toBe(0);
    expect(result.intervalDays).toBe(1);
  });

  it("equals compressIntervalForExam applied to the uncompressed interval", () => {
    // Cross-check the extracted function against sm2Next across all branches
    // (past exam, 1-3, 4-7, 8-14, >14 days) and pass/fail qualities.
    for (const d of [-2, 0, 1, 2, 3, 4, 5, 7, 8, 10, 14, 15, 21, 30, 60, 120]) {
      const exam = daysFromNow(d);
      for (const q of [0, 2, 3, 4, 5]) {
        const withExam = sm2Next(advanced, q, now, exam);
        const base = sm2Next(advanced, q, now);
        expect(withExam.intervalDays).toBe(compressIntervalForExam(base.intervalDays, exam, now));
        expect(withExam.easeFactor).toBe(base.easeFactor);
        expect(withExam.repetitions).toBe(base.repetitions);
      }
    }
  });
});
