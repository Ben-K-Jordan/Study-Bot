/**
 * Break protocol enforcement logic.
 * All time tracking uses absolute timestamps (survives tab sleep / refresh).
 */

interface BreakConfig {
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

const DEFAULT_BREAK: BreakConfig = { workMinutes: 50, breakMinutes: 10 };

export function getBreakConfig(type: string): BreakConfig {
  return BREAK_MAP[type] ?? DEFAULT_BREAK;
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
  return (protocol?.cycles ?? 1) >= 2;
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
    blocks: protocol.cycles ?? 1,
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
