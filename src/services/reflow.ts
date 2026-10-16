/**
 * Plan Reflow Service
 *
 * Deterministic algorithm that reschedules study plan items into available
 * time slots.
 *
 * Algorithm:
 * 1. Separate items into fixed and movable. By default the movable items are
 *    the SCHEDULED, unlocked, future ones. With `includeMissed` (the Plan
 *    screen's "Reschedule sessions") the missed sessions move instead: items
 *    marked MISSED and scheduled ones whose day ended without them being
 *    started (one from earlier today can still be started, as the Plan
 *    screen shows it). Future sessions keep their place, which keeps their
 *    spacing, unless they fall after `lastDay` or clash with busy time.
 * 2. Build day grids from the plan availability config, from the plan's
 *    first day through the horizon (the later of plan day 6 and the latest
 *    item's day, or `lastDay` when given, such as the day before the exam)
 * 3. Subtract fixed items from day grids to get free slots
 * 4. Sort movable items by phase priority (RETRIEVAL first, then INTERLEAVED, etc.)
 * 5. Greedy first-fit placement into free slots
 * 6. Items that don't fit → DROPPED warning
 *
 * Day boundaries and availability windows are wall-clock times in the plan's
 * timezone, never the server's, so the result does not depend on where the
 * server runs.
 */

import { computeFreeSlots, fitBlocksIntoSlots, type TimeInterval } from "@/lib/google/free-slots";
import { addDays, dayKey, daysBetween, zonedTimeToUtc } from "@/lib/timezone";

// ---- Types ----

export const ITEM_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "DONE",
  "MISSED",
  "SKIPPED",
  "RESCHEDULED",
] as const;

/** Phase priority: lower number = higher priority (scheduled first) */
const MODE_PRIORITY: Record<string, number> = {
  RETRIEVAL: 0,
  INTERLEAVED_PRACTICE: 1,
  ERROR_REPAIR: 2,
  EXAM_SIM: 3,
  WORKED_EXAMPLES: 4,
};

const DEFAULT_WINDOW = { start: "09:00", end: "17:00" };

export interface ReflowItem {
  id: string;
  sessionId: string;
  dayIndex: number;
  startTime: Date;
  endTime: Date;
  status: string;
  locked: boolean;
  mode: string;
  plannedMinutes: number;
}

export interface ReflowConfig {
  availability: { start: string; end: string }[];
  daily_study_cap_minutes: number;
}

export interface ReflowOptions {
  /**
   * Busy time a kept session must not overlap (includeMissed only), without
   * the buffer `busyIntervals` adds around events for new placements.
   * Defaults to `busyIntervals`.
   */
  clashIntervals?: TimeInterval[];
  /**
   * Move missed sessions: items marked MISSED, and SCHEDULED or RESCHEDULED
   * items whose time passed without being started. Future sessions stay put
   * (reported as KEPT) unless they land after `lastDay` or overlap a busy
   * interval; then they move too.
   */
  includeMissed?: boolean;
  /**
   * Last calendar day (YYYY-MM-DD in the plan's timezone) a session may be
   * placed on, such as the day before the exam. Without it the horizon is
   * the later of plan day 6 and the latest item's day.
   */
  lastDay?: string;
}

export interface ReflowChange {
  itemId: string;
  sessionId: string;
  action: "MOVED" | "DROPPED" | "KEPT";
  before: { dayIndex: number; startTime: string; endTime: string } | null;
  after: { dayIndex: number; startTime: string; endTime: string } | null;
  /** True when the item was a missed session (only with includeMissed). */
  missed?: boolean;
}

export interface ReflowWarning {
  itemId: string;
  sessionId: string;
  code: "DROPPED" | "DAILY_CAP_EXCEEDED";
  message: string;
}

export interface ReflowResult {
  changes: ReflowChange[];
  warnings: ReflowWarning[];
  algorithmVersion: string;
}

// ---- Helpers ----

/** The instant of a wall-clock time ("HH:MM") on plan day `dayIndex` in the plan's timezone. */
function computeStartOfDay(
  planStartDate: Date,
  dayIndex: number,
  timeStr: string,
  timeZone: string | null,
): Date {
  const day = addDays(dayKey(planStartDate, timeZone), dayIndex);
  return zonedTimeToUtc(day, timeStr, timeZone);
}

function getModePriority(mode: string): number {
  return MODE_PRIORITY[mode] ?? 99;
}

/** Plan day index of an instant, counting calendar days in the plan's timezone. */
function dayIndexFromTime(planStartDate: Date, time: Date, timeZone: string | null): number {
  return daysBetween(dayKey(planStartDate, timeZone), dayKey(time, timeZone));
}

/** Availability for a plan day; the configured week repeats past day 6. */
function windowForDay(config: ReflowConfig, dayIdx: number) {
  const days = config.availability;
  if (!days || days.length === 0) return DEFAULT_WINDOW;
  return days[dayIdx % days.length] ?? DEFAULT_WINDOW;
}

/**
 * Whether an item is a missed session: marked MISSED, or its time passed
 * unstarted. With a timezone, only once its day has ended there, matching
 * the Plan screen (classifyPlanItem) and Home: a 2 PM session can still be
 * started that evening, so Reschedule leaves it alone until tomorrow.
 */
export function isMissedItem(
  item: Pick<ReflowItem, "status" | "endTime">,
  now: Date,
  timeZone?: string | null,
): boolean {
  if (item.status === "MISSED") return true;
  if (item.status !== "SCHEDULED" && item.status !== "RESCHEDULED") return false;
  if (item.endTime.getTime() > now.getTime()) return false;
  if (timeZone && dayKey(item.endTime, timeZone) === dayKey(now, timeZone)) return false;
  return true;
}

/**
 * `busy` minus `own`: what is left of each busy interval after cutting out
 * the given ones. Google's free/busy merges touching events into one block,
 * so a plan's own events are cut out of a block rather than matched whole.
 */
export function subtractIntervals(busy: readonly TimeInterval[], own: readonly TimeInterval[]): TimeInterval[] {
  const cuts = [...own].filter((c) => c.end > c.start).sort((a, b) => a.start - b.start);
  const out: TimeInterval[] = [];
  for (const block of busy) {
    let pieces: TimeInterval[] = [{ start: block.start, end: block.end }];
    for (const cut of cuts) {
      if (cut.start >= block.end) break;
      if (cut.end <= block.start) continue;
      pieces = pieces.flatMap((piece) => {
        if (cut.end <= piece.start || cut.start >= piece.end) return [piece];
        const left = { start: piece.start, end: Math.min(piece.end, cut.start) };
        const right = { start: Math.max(piece.start, cut.end), end: piece.end };
        return [left, right].filter((p) => p.end > p.start);
      });
    }
    out.push(...pieces);
  }
  return out;
}

// ---- Core Algorithm ----

export const ALGORITHM_VERSION = "v1";

/**
 * Compute the reflow diff without applying changes.
 *
 * @param items - All items in the plan
 * @param config - Plan config (availability, daily cap)
 * @param planStartDate - An instant on the plan's first day (in its timezone)
 * @param now - Current time (for determining past items)
 * @param busyIntervals - Optional external busy intervals (Google Calendar)
 * @param timeZone - IANA timezone of the plan; null means UTC
 * @param options - Missed-session handling and the horizon
 */
export function computeReflow(
  items: ReflowItem[],
  config: ReflowConfig,
  planStartDate: Date,
  now: Date = new Date(),
  busyIntervals: TimeInterval[] = [],
  timeZone: string | null = null,
  options: ReflowOptions = {},
): ReflowResult {
  const changes: ReflowChange[] = [];
  const warnings: ReflowWarning[] = [];
  const includeMissed = options.includeMissed === true;
  const clashIntervals = options.clashIntervals ?? busyIntervals;

  // Classify items
  const fixed: ReflowItem[] = [];
  const movable: ReflowItem[] = [];
  /** Future sessions that keep their time (includeMissed only); they block time like fixed ones. */
  const stays: ReflowItem[] = [];
  const missedIds = new Set<string>();

  for (const item of items) {
    if (item.locked || item.status === "IN_PROGRESS") {
      fixed.push(item);
      continue;
    }

    if (includeMissed) {
      if (isMissedItem(item, now, timeZone)) {
        missedIds.add(item.id);
        movable.push(item);
      } else if (item.status === "SCHEDULED" || item.status === "RESCHEDULED") {
        // Earlier today and not started: it stays, and can still be started
        const earlierToday = item.endTime.getTime() <= now.getTime();
        const afterHorizon =
          options.lastDay !== undefined && dayKey(item.startTime, timeZone) > options.lastDay;
        const clashes = clashIntervals.some(
          (b) => b.start < item.endTime.getTime() && b.end > item.startTime.getTime(),
        );
        if (!earlierToday && (afterHorizon || clashes)) movable.push(item);
        else stays.push(item);
      } else {
        fixed.push(item); // DONE, SKIPPED
      }
      continue;
    }

    const isPast = item.endTime.getTime() <= now.getTime();
    const isTerminal = ["DONE", "MISSED", "SKIPPED", "RESCHEDULED"].includes(item.status);
    if (isPast || isTerminal) {
      fixed.push(item);
    } else {
      movable.push(item);
    }
  }

  // Sessions that stay are reported as KEPT and block their time
  for (const item of stays) {
    const slot = {
      dayIndex: item.dayIndex,
      startTime: item.startTime.toISOString(),
      endTime: item.endTime.toISOString(),
    };
    changes.push({ itemId: item.id, sessionId: item.sessionId, action: "KEPT", before: slot, after: { ...slot }, missed: false });
    fixed.push(item);
  }

  if (movable.length === 0) {
    return { changes, warnings: [], algorithmVersion: ALGORITHM_VERSION };
  }

  // Sort movable by phase priority, then by original start time (stable)
  movable.sort((a, b) => {
    const pDiff = getModePriority(a.mode) - getModePriority(b.mode);
    if (pDiff !== 0) return pDiff;
    return a.startTime.getTime() - b.startTime.getTime();
  });

  // Build day grids from the plan's first day through the horizon. Plans
  // older than a week and follow-ups past day 6 need days beyond the first 7.
  let lastIndex: number;
  if (options.lastDay) {
    lastIndex = daysBetween(dayKey(planStartDate, timeZone), options.lastDay);
  } else {
    lastIndex = Math.max(config.availability.length - 1, 6);
    for (const item of items) {
      lastIndex = Math.max(lastIndex, dayIndexFromTime(planStartDate, item.startTime, timeZone));
    }
  }
  const totalDays = Math.max(0, lastIndex + 1);

  // Fixed item intervals (these block time)
  const fixedIntervals: TimeInterval[] = fixed
    .filter((item) => item.startTime.getTime() < item.endTime.getTime())
    .map((item) => ({
      start: item.startTime.getTime(),
      end: item.endTime.getTime(),
    }));

  // Combine with external busy intervals
  const allBusy = [...fixedIntervals, ...busyIntervals];

  // Fixed minutes per plan day, for the daily cap
  const fixedMsByDay = new Map<number, number>();
  for (const item of fixed) {
    const day = dayIndexFromTime(planStartDate, item.startTime, timeZone);
    const dur = item.endTime.getTime() - item.startTime.getTime();
    fixedMsByDay.set(day, (fixedMsByDay.get(day) ?? 0) + Math.max(0, dur));
  }

  // Compute free slots per day, respecting daily cap
  const dayFreeSlots: TimeInterval[][] = [];
  const dayCapMs = config.daily_study_cap_minutes * 60 * 1000;

  for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
    const avail = windowForDay(config, dayIdx);
    const windowStart = computeStartOfDay(planStartDate, dayIdx, avail.start, timeZone);
    const windowEnd = computeStartOfDay(planStartDate, dayIdx, avail.end, timeZone);

    // Skip days entirely in the past
    if (windowEnd.getTime() <= now.getTime()) {
      dayFreeSlots.push([]);
      continue;
    }

    // Adjust window start to now if partially in the past
    const effectiveStart = Math.max(windowStart.getTime(), now.getTime());

    const free = computeFreeSlots(effectiveStart, windowEnd.getTime(), allBusy);

    // Enforce daily study cap: subtract fixed items on this day
    const remainingCapMs = Math.max(0, dayCapMs - (fixedMsByDay.get(dayIdx) ?? 0));

    // Trim free slots to remaining cap
    const cappedSlots: TimeInterval[] = [];
    let usedMs = 0;
    for (const slot of free) {
      if (usedMs >= remainingCapMs) break;
      const slotDur = slot.end - slot.start;
      const canUse = Math.min(slotDur, remainingCapMs - usedMs);
      if (canUse >= 15 * 60 * 1000) { // minimum 15 min slot
        cappedSlots.push({ start: slot.start, end: slot.start + canUse });
      }
      usedMs += canUse;
    }

    dayFreeSlots.push(cappedSlots);
  }

  // Flatten all free slots across days (already ordered by day/time)
  const allFreeSlots: TimeInterval[] = dayFreeSlots.flat();

  // Greedy placement
  const durations = movable.map((item) => item.plannedMinutes * 60 * 1000);
  const placements = fitBlocksIntoSlots(durations, allFreeSlots);

  for (let i = 0; i < movable.length; i++) {
    const item = movable[i];
    const placement = placements[i];
    const missed = missedIds.has(item.id);
    const before = {
      dayIndex: item.dayIndex,
      startTime: item.startTime.toISOString(),
      endTime: item.endTime.toISOString(),
    };

    if (!placement) {
      // DROPPED: no slot available
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "DROPPED",
        before,
        after: null,
        ...(includeMissed ? { missed } : {}),
      });
      warnings.push({
        itemId: item.id,
        sessionId: item.sessionId,
        code: "DROPPED",
        message: `No free time left for this ${item.plannedMinutes}-minute session.`,
      });
      continue;
    }

    const newStart = new Date(placement.start);
    const newEnd = new Date(placement.end);
    const newDayIndex = dayIndexFromTime(planStartDate, newStart, timeZone);

    // Check if position actually changed
    const startChanged = Math.abs(item.startTime.getTime() - newStart.getTime()) > 1000;
    const endChanged = Math.abs(item.endTime.getTime() - newEnd.getTime()) > 1000;

    if (startChanged || endChanged || missed) {
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "MOVED",
        before,
        after: {
          dayIndex: newDayIndex,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
        ...(includeMissed ? { missed } : {}),
      });
    } else {
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "KEPT",
        before,
        after: { ...before },
        ...(includeMissed ? { missed } : {}),
      });
    }
  }

  return { changes, warnings, algorithmVersion: ALGORITHM_VERSION };
}
