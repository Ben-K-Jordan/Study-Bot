/**
 * Break protocol enforcement logic.
 * All time tracking uses absolute timestamps (survives tab sleep / refresh).
 */
import { isTestAuthEnabled } from "./test-auth";

interface BreakConfig {
  workMinutes: number;
  breakMinutes: number;
}

/** Break patterns a session can use: work minutes, then break minutes. */
export const BREAK_TYPES = ["12_3", "25_5", "50_10", "90_15"] as const;

/**
 * Patterns with blocks of a few seconds, so the e2e and integration suites
 * can reach a break without waiting. Only test environments accept them.
 */
export const TEST_BREAK_TYPES = ["TEST_1_1", "TEST_3_2"] as const;

/**
 * Most work blocks one session can have: 240 planned minutes (the longest
 * session) in the shortest pattern, 12 + 3, is 16 blocks.
 */
export const MAX_BREAK_CYCLES = 16;

const BREAK_MAP: Record<string, BreakConfig> = {
  "12_3": { workMinutes: 12, breakMinutes: 3 },
  "25_5": { workMinutes: 25, breakMinutes: 5 },
  "50_10": { workMinutes: 50, breakMinutes: 10 },
  "90_15": { workMinutes: 90, breakMinutes: 15 },
};

const TEST_BREAK_MAP: Record<string, BreakConfig> = {
  // 1-second work and 1-second break
  TEST_1_1: { workMinutes: 1 / 60, breakMinutes: 1 / 60 },
  // 3-second work and 2-second break
  TEST_3_2: { workMinutes: 3 / 60, breakMinutes: 2 / 60 },
};

const DEFAULT_BREAK: BreakConfig = { workMinutes: 50, breakMinutes: 10 };

/**
 * Whether the test patterns are honoured: in development and unit tests, and
 * in a production build only while the e2e suite's test auth is on. A real
 * deployment treats them as unknown, so a request can't make a session
 * break every second.
 */
export function testBreaksAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || isTestAuthEnabled();
}

/** True for a pattern a new session may use here (test patterns only where allowed). */
export function isAllowedBreakType(type: string): boolean {
  if ((BREAK_TYPES as readonly string[]).includes(type)) return true;
  return (TEST_BREAK_TYPES as readonly string[]).includes(type) && testBreaksAllowed();
}

/** Work and break minutes for a pattern; unknown patterns, and test ones outside tests, get 50 + 10. */
export function getBreakConfig(type: string): BreakConfig {
  const config = BREAK_MAP[type];
  if (config) return config;
  const test = TEST_BREAK_MAP[type];
  return test && testBreaksAllowed() ? test : DEFAULT_BREAK;
}

/** A stored cycle count as a whole number from 1 to MAX_BREAK_CYCLES (rows saved before the cap included). */
function clampCycles(cycles: number | undefined): number {
  if (typeof cycles !== "number" || !Number.isFinite(cycles)) return 1;
  return Math.min(Math.max(Math.trunc(cycles), 1), MAX_BREAK_CYCLES);
}

export interface BreakProtocol {
  type?: string;
  cycles?: number;
}

export interface BreakState {
  /** ISO timestamp of when the current work block started */
  work_started_at: string;
  /** Which work block we're in (0-indexed) */
  current_cycle: number;
  /** Total cycles configured */
  total_cycles: number;
  /** Whether user is currently on break */
  on_break: boolean;
  /** ISO timestamp of when break started (if on_break) */
  break_started_at?: string;
  /** Break duration in seconds for current break */
  break_duration_seconds?: number;
  /** Work duration in seconds per block */
  work_duration_seconds: number;
  /** Timestamps of completed breaks */
  completed_breaks: string[];
}

export function initBreakState(protocol: BreakProtocol | null): BreakState {
  const type = protocol?.type ?? "50_10";
  const cycles = clampCycles(protocol?.cycles);
  const config = getBreakConfig(type);

  return {
    work_started_at: new Date().toISOString(),
    current_cycle: 0,
    total_cycles: cycles,
    on_break: false,
    work_duration_seconds: config.workMinutes * 60,
    break_duration_seconds: config.breakMinutes * 60,
    completed_breaks: [],
  };
}

/**
 * Check if a break should trigger based on elapsed work time.
 * Returns updated break state.
 */
export function checkBreakNeeded(state: BreakState, now: Date = new Date()): BreakState {
  if (state.on_break) return state;

  // If we're on the last cycle, no more breaks needed
  if (state.current_cycle >= state.total_cycles - 1) return state;

  const workStart = new Date(state.work_started_at);
  const elapsedSeconds = (now.getTime() - workStart.getTime()) / 1000;

  if (elapsedSeconds < state.work_duration_seconds) return state;

  // Away long enough for a break and a whole second block to have passed (a
  // student resuming the next day, say): that time away was the break, so
  // start the next block now instead of making them sit out another one.
  // The margin keeps a long question that runs past the block end from
  // skipping the break.
  const breakSeconds = state.break_duration_seconds ?? 0;
  if (elapsedSeconds >= 2 * state.work_duration_seconds + breakSeconds) {
    const breakStartedAt = new Date(workStart.getTime() + state.work_duration_seconds * 1000);
    return {
      ...state,
      on_break: false,
      break_started_at: undefined,
      current_cycle: state.current_cycle + 1,
      work_started_at: now.toISOString(),
      completed_breaks: [...state.completed_breaks, breakStartedAt.toISOString()],
    };
  }

  return {
    ...state,
    on_break: true,
    break_started_at: now.toISOString(),
  };
}

/** Whether a protocol has a break at all: one work block never breaks. */
export function hasBreaks(protocol: BreakProtocol | null | undefined): boolean {
  return clampCycles(protocol?.cycles) >= 2;
}

export interface BreakSchedule {
  /** Work blocks in the session. */
  blocks: number;
  workMinutes: number;
  breakMinutes: number;
}

/**
 * The protocol in whole minutes for the preflight ("2 blocks of 25 min with
 * a 5 min break"), or null when the session has a single block.
 */
export function breakSchedule(protocol: BreakProtocol | null | undefined): BreakSchedule | null {
  if (!protocol || !hasBreaks(protocol)) return null;
  const config = getBreakConfig(protocol.type ?? "50_10");
  return {
    blocks: clampCycles(protocol.cycles),
    workMinutes: Math.max(1, Math.round(config.workMinutes)),
    breakMinutes: Math.max(1, Math.round(config.breakMinutes)),
  };
}

/** When the current break ends, or null when not on a break. */
export function breakEndsAt(state: BreakState): Date | null {
  if (!state.on_break || !state.break_started_at) return null;
  const start = Date.parse(state.break_started_at);
  if (Number.isNaN(start)) return null;
  const duration = state.break_duration_seconds ?? getBreakConfig("50_10").breakMinutes * 60;
  return new Date(start + duration * 1000);
}

/** Whole seconds left in the current break (0 when it is over or not running). */
export function breakRemainingSeconds(state: BreakState, now: Date = new Date()): number {
  const end = breakEndsAt(state);
  if (!end) return 0;
  return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 1000));
}

/**
 * Force-end a break early (user chose to skip remaining break time).
 */
export function endBreakEarly(state: BreakState, now: Date = new Date()): BreakState {
  if (!state.on_break || !state.break_started_at) return state;

  return {
    ...state,
    on_break: false,
    break_started_at: undefined,
    current_cycle: state.current_cycle + 1,
    work_started_at: now.toISOString(),
    completed_breaks: [...state.completed_breaks, state.break_started_at],
  };
}
