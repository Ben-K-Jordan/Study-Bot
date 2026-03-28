/**
 * Break protocol enforcement logic.
 * All time tracking uses absolute timestamps (survives tab sleep / refresh).
 */

export interface BreakConfig {
  workMinutes: number;
  breakMinutes: number;
}

const BREAK_MAP: Record<string, BreakConfig> = {
  "12_3": { workMinutes: 12, breakMinutes: 3 },
  "25_5": { workMinutes: 25, breakMinutes: 5 },
  "50_10": { workMinutes: 50, breakMinutes: 10 },
  "90_15": { workMinutes: 90, breakMinutes: 15 },
  // Test-only: 1-second work / 1-second break for deterministic E2E tests
  TEST_1_1: { workMinutes: 1 / 60, breakMinutes: 1 / 60 },
  // Test-only: 3-second work / 2-second break
  TEST_3_2: { workMinutes: 3 / 60, breakMinutes: 2 / 60 },
};

export function getBreakConfig(type: string): BreakConfig {
  return BREAK_MAP[type] ?? { workMinutes: 50, breakMinutes: 10 };
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
  const cycles = protocol?.cycles ?? 1;
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

  if (elapsedSeconds >= state.work_duration_seconds) {
    return {
      ...state,
      on_break: true,
      break_started_at: now.toISOString(),
    };
  }

  return state;
}

/**
 * Check if the current break has ended.
 * If so, advance to the next work cycle.
 */
export function checkBreakEnded(state: BreakState, now: Date = new Date()): BreakState {
  if (!state.on_break || !state.break_started_at) return state;

  const breakStart = new Date(state.break_started_at);
  const elapsedSeconds = (now.getTime() - breakStart.getTime()) / 1000;
  const breakDuration = state.break_duration_seconds ?? 600;

  if (elapsedSeconds >= breakDuration) {
    return {
      ...state,
      on_break: false,
      break_started_at: undefined,
      current_cycle: state.current_cycle + 1,
      work_started_at: now.toISOString(),
      completed_breaks: [...state.completed_breaks, state.break_started_at],
    };
  }

  return state;
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

/**
 * Compute remaining seconds in the current break.
 */
export function breakRemainingSeconds(state: BreakState, now: Date = new Date()): number {
  if (!state.on_break || !state.break_started_at) return 0;
  const breakStart = new Date(state.break_started_at);
  const elapsed = (now.getTime() - breakStart.getTime()) / 1000;
  const remaining = (state.break_duration_seconds ?? 600) - elapsed;
  return Math.max(0, Math.ceil(remaining));
}

/**
 * Compute remaining seconds in the current work block.
 */
export function workRemainingSeconds(state: BreakState, now: Date = new Date()): number {
  if (state.on_break) return 0;
  const workStart = new Date(state.work_started_at);
  const elapsed = (now.getTime() - workStart.getTime()) / 1000;
  const remaining = state.work_duration_seconds - elapsed;
  return Math.max(0, Math.ceil(remaining));
}
