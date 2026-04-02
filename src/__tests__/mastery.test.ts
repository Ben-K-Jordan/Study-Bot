/**
 * Unit tests for the SM-2 mastery engine.
 */
import { describe, it, expect } from "vitest";
import { accuracyToQuality, sm2Next, type SM2State } from "@/lib/mastery";

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
