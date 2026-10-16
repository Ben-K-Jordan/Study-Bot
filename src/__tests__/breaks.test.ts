import { describe, it, expect } from "vitest";
import {
  getBreakConfig,
  initBreakState,
  checkBreakNeeded,
  endBreakEarly,
} from "@/lib/breaks";

describe("getBreakConfig", () => {
  it("maps 50_10 correctly", () => {
    expect(getBreakConfig("50_10")).toEqual({ workMinutes: 50, breakMinutes: 10 });
  });

  it("maps 25_5 correctly", () => {
    expect(getBreakConfig("25_5")).toEqual({ workMinutes: 25, breakMinutes: 5 });
  });

  it("maps 90_15 correctly", () => {
    expect(getBreakConfig("90_15")).toEqual({ workMinutes: 90, breakMinutes: 15 });
  });

  it("maps 12_3 correctly", () => {
    expect(getBreakConfig("12_3")).toEqual({ workMinutes: 12, breakMinutes: 3 });
  });

  it("falls back to 50_10 for unknown types", () => {
    expect(getBreakConfig("unknown")).toEqual({ workMinutes: 50, breakMinutes: 10 });
  });
});

describe("initBreakState", () => {
  it("creates initial state with correct work duration", () => {
    const state = initBreakState({ type: "25_5", cycles: 3 });
    expect(state.current_cycle).toBe(0);
    expect(state.total_cycles).toBe(3);
    expect(state.on_break).toBe(false);
    expect(state.work_duration_seconds).toBe(25 * 60);
    expect(state.break_duration_seconds).toBe(5 * 60);
    expect(state.completed_breaks).toEqual([]);
  });

  it("defaults to 50_10 with 1 cycle when null", () => {
    const state = initBreakState(null);
    expect(state.total_cycles).toBe(1);
    expect(state.work_duration_seconds).toBe(50 * 60);
  });
});

describe("checkBreakNeeded", () => {
  it("triggers break when work duration exceeded", () => {
    const workStart = new Date(Date.now() - 51 * 60 * 1000); // 51 min ago
    const state = initBreakState({ type: "50_10", cycles: 2 });
    state.work_started_at = workStart.toISOString();

    const result = checkBreakNeeded(state);
    expect(result.on_break).toBe(true);
    expect(result.break_started_at).toBeDefined();
  });

  it("does not trigger break when work is still in progress", () => {
    const state = initBreakState({ type: "50_10", cycles: 2 });
    // work_started_at is "now", so no break needed
    const result = checkBreakNeeded(state);
    expect(result.on_break).toBe(false);
  });

  it("does not trigger break on last cycle", () => {
    const workStart = new Date(Date.now() - 51 * 60 * 1000);
    const state = initBreakState({ type: "50_10", cycles: 2 });
    state.work_started_at = workStart.toISOString();
    state.current_cycle = 1; // Last cycle (0-indexed, total_cycles=2)

    const result = checkBreakNeeded(state);
    expect(result.on_break).toBe(false);
  });
});

describe("endBreakEarly", () => {
  it("ends break and advances cycle", () => {
    const state = initBreakState({ type: "50_10", cycles: 2 });
    state.on_break = true;
    state.break_started_at = new Date().toISOString();

    const result = endBreakEarly(state);
    expect(result.on_break).toBe(false);
    expect(result.current_cycle).toBe(1);
    expect(result.completed_breaks).toHaveLength(1);
  });
});
