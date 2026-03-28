import { describe, it, expect } from "vitest";
import { getBreakConfig, initBreakState, checkBreakNeeded, checkBreakEnded } from "@/lib/breaks";

describe("test break protocols (TEST_1_1, TEST_3_2)", () => {
  it("maps TEST_1_1 to ~1 second work / ~1 second break", () => {
    const config = getBreakConfig("TEST_1_1");
    expect(config.workMinutes).toBeCloseTo(1 / 60, 5);
    expect(config.breakMinutes).toBeCloseTo(1 / 60, 5);
  });

  it("maps TEST_3_2 to ~3 second work / ~2 second break", () => {
    const config = getBreakConfig("TEST_3_2");
    expect(config.workMinutes).toBeCloseTo(3 / 60, 5);
    expect(config.breakMinutes).toBeCloseTo(2 / 60, 5);
  });

  it("triggers break after 1 second with TEST_1_1", () => {
    const state = initBreakState({ type: "TEST_1_1", cycles: 2 });
    // Simulate 1.5 seconds passing
    const futureDate = new Date(Date.now() + 1500);
    const result = checkBreakNeeded(state, futureDate);
    expect(result.on_break).toBe(true);
  });

  it("ends break after 1 second with TEST_1_1", () => {
    const state = initBreakState({ type: "TEST_1_1", cycles: 2 });
    state.on_break = true;
    state.break_started_at = new Date().toISOString();
    // Simulate 1.5 seconds passing
    const futureDate = new Date(Date.now() + 1500);
    const result = checkBreakEnded(state, futureDate);
    expect(result.on_break).toBe(false);
    expect(result.current_cycle).toBe(1);
  });
});
