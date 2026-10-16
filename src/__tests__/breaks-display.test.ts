import { describe, it, expect } from "vitest";
import {
  breakEndsAt,
  breakRemainingSeconds,
  breakSchedule,
  checkBreakNeeded,
  hasBreaks,
  initBreakState,
} from "@/lib/breaks";

const NOW = new Date("2026-10-15T18:00:00Z");

describe("hasBreaks and breakSchedule", () => {
  it("treats one work block as no breaks", () => {
    expect(hasBreaks({ type: "25_5", cycles: 1 })).toBe(false);
    expect(hasBreaks(null)).toBe(false);
    expect(breakSchedule({ type: "25_5", cycles: 1 })).toBeNull();
  });

  it("describes a protocol with breaks in whole minutes", () => {
    expect(breakSchedule({ type: "25_5", cycles: 2 })).toEqual({ blocks: 2, workMinutes: 25, breakMinutes: 5 });
    expect(breakSchedule({ type: "50_10", cycles: 3 })).toEqual({ blocks: 3, workMinutes: 50, breakMinutes: 10 });
  });

  it("never shows a test protocol as zero minutes", () => {
    expect(breakSchedule({ type: "TEST_3_2", cycles: 2 })).toEqual({ blocks: 2, workMinutes: 1, breakMinutes: 1 });
  });
});

describe("breakEndsAt and breakRemainingSeconds", () => {
  function onBreak(startedSecondsAgo: number) {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    return {
      ...state,
      on_break: true,
      break_started_at: new Date(NOW.getTime() - startedSecondsAgo * 1000).toISOString(),
    };
  }

  it("counts down from the break's server start time", () => {
    const state = onBreak(60);
    expect(breakEndsAt(state)?.toISOString()).toBe("2026-10-15T18:04:00.000Z");
    expect(breakRemainingSeconds(state, NOW)).toBe(240);
  });

  it("stops at zero once the break is over", () => {
    expect(breakRemainingSeconds(onBreak(600), NOW)).toBe(0);
  });

  it("is zero and has no end when not on a break", () => {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    expect(breakEndsAt(state)).toBeNull();
    expect(breakRemainingSeconds(state, NOW)).toBe(0);
  });
});

describe("checkBreakNeeded after a long time away", () => {
  it("still starts a break right after a work block", () => {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    state.work_started_at = new Date(NOW.getTime() - 26 * 60 * 1000).toISOString();
    const next = checkBreakNeeded(state, NOW);
    expect(next.on_break).toBe(true);
    expect(next.break_started_at).toBe(NOW.toISOString());
  });

  it("still starts the break when a long question runs past the block end", () => {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    state.work_started_at = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();
    expect(checkBreakNeeded(state, NOW).on_break).toBe(true);
  });

  it("counts a long time away as the break", () => {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    state.work_started_at = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    const next = checkBreakNeeded(state, NOW);
    expect(next.on_break).toBe(false);
    expect(next.current_cycle).toBe(1);
    expect(next.work_started_at).toBe(NOW.toISOString());
    expect(next.completed_breaks).toHaveLength(1);
  });

  it("does nothing on the last block", () => {
    const state = initBreakState({ type: "25_5", cycles: 2 });
    state.current_cycle = 1;
    state.work_started_at = new Date(NOW.getTime() - 3 * 60 * 60 * 1000).toISOString();
    expect(checkBreakNeeded(state, NOW)).toBe(state);
  });
});
