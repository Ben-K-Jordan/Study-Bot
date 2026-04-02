/**
 * Plan Reflow Service
 *
 * Deterministic algorithm that reschedules remaining SCHEDULED study plan items
 * into available time slots after items are marked DONE/MISSED/SKIPPED.
 *
 * Algorithm:
 * 1. Separate items into fixed (DONE/MISSED/SKIPPED/locked/past) and movable (SCHEDULED, unlocked, future)
 * 2. Build day grids from plan availability config
 * 3. Subtract fixed items from day grids to get free slots
 * 4. Sort movable items by phase priority (RETRIEVAL first, then INTERLEAVED, etc.)
 * 5. Greedy first-fit placement into free slots
 * 6. Items that don't fit → DROPPED warning
 */

import { computeFreeSlots, fitBlocksIntoSlots, type TimeInterval } from "@/lib/google/free-slots";

// ---- Types ----

export const ITEM_STATUSES = [
  "SCHEDULED",
  "IN_PROGRESS",
  "DONE",
  "MISSED",
  "SKIPPED",
  "RESCHEDULED",
] as const;

export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Phase priority: lower number = higher priority (scheduled first) */
const MODE_PRIORITY: Record<string, number> = {
  RETRIEVAL: 0,
  INTERLEAVED_PRACTICE: 1,
  ERROR_REPAIR: 2,
  EXAM_SIM: 3,
  WORKED_EXAMPLES: 4,
  OFFICE_HOURS_PREP: 5,
};

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

export interface ReflowChange {
  itemId: string;
  sessionId: string;
  action: "MOVED" | "DROPPED" | "KEPT";
  before: { dayIndex: number; startTime: string; endTime: string } | null;
  after: { dayIndex: number; startTime: string; endTime: string } | null;
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

function computeStartOfDay(planStartDate: Date, dayIndex: number, timeStr: string): Date {
  const d = new Date(planStartDate);
  d.setDate(d.getDate() + dayIndex);
  const [h, m] = timeStr.split(":").map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

function availableMinutes(avail: { start: string; end: string }): number {
  const [sh, sm] = avail.start.split(":").map(Number);
  const [eh, em] = avail.end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function getModePriority(mode: string): number {
  return MODE_PRIORITY[mode] ?? 99;
}

function dayIndexFromTime(planStartDate: Date, time: Date): number {
  const planStart = new Date(planStartDate);
  planStart.setHours(0, 0, 0, 0);
  const target = new Date(time);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - planStart.getTime()) / (24 * 60 * 60 * 1000));
}

// ---- Core Algorithm ----

export const ALGORITHM_VERSION = "v1";

/**
 * Compute the reflow diff without applying changes.
 *
 * @param items - All items in the plan
 * @param config - Plan config (availability, daily cap)
 * @param planStartDate - The plan's start date
 * @param now - Current time (for determining past items)
 * @param busyIntervals - Optional external busy intervals (Google Calendar)
 */
export function computeReflow(
  items: ReflowItem[],
  config: ReflowConfig,
  planStartDate: Date,
  now: Date = new Date(),
  busyIntervals: TimeInterval[] = [],
): ReflowResult {
  const changes: ReflowChange[] = [];
  const warnings: ReflowWarning[] = [];

  // Classify items
  const fixed: ReflowItem[] = [];
  const movable: ReflowItem[] = [];

  for (const item of items) {
    const isPast = item.endTime.getTime() <= now.getTime();
    const isTerminal = ["DONE", "MISSED", "SKIPPED", "RESCHEDULED"].includes(item.status);
    const isLocked = item.locked;
    const isInProgress = item.status === "IN_PROGRESS";

    if (isPast || isTerminal || isLocked || isInProgress) {
      fixed.push(item);
    } else {
      movable.push(item);
    }
  }

  if (movable.length === 0) {
    return { changes: [], warnings: [], algorithmVersion: ALGORITHM_VERSION };
  }

  // Sort movable by phase priority, then by original start time (stable)
  movable.sort((a, b) => {
    const pDiff = getModePriority(a.mode) - getModePriority(b.mode);
    if (pDiff !== 0) return pDiff;
    return a.startTime.getTime() - b.startTime.getTime();
  });

  // Build day grids: 7 days from plan start
  const totalDays = config.availability.length; // typically 7

  // Build fixed item intervals per day (these block time)
  const fixedIntervals: TimeInterval[] = fixed
    .filter((item) => item.startTime.getTime() < item.endTime.getTime())
    .map((item) => ({
      start: item.startTime.getTime(),
      end: item.endTime.getTime(),
    }));

  // Combine with external busy intervals
  const allBusy = [...fixedIntervals, ...busyIntervals];

  // Compute free slots per day, respecting daily cap
  const dayFreeSlots: TimeInterval[][] = [];
  const dayCapMs = config.daily_study_cap_minutes * 60 * 1000;

  for (let dayIdx = 0; dayIdx < totalDays; dayIdx++) {
    const avail = config.availability[dayIdx];
    const windowStart = computeStartOfDay(planStartDate, dayIdx, avail.start);
    const windowEnd = computeStartOfDay(planStartDate, dayIdx, avail.end);

    // Skip days entirely in the past
    if (windowEnd.getTime() <= now.getTime()) {
      dayFreeSlots.push([]);
      continue;
    }

    // Adjust window start to now if partially in the past
    const effectiveStart = Math.max(windowStart.getTime(), now.getTime());

    const free = computeFreeSlots(effectiveStart, windowEnd.getTime(), allBusy);

    // Enforce daily study cap: sum fixed items on this day, limit remaining
    const fixedOnDay = fixed.filter((item) => {
      const itemDay = dayIndexFromTime(planStartDate, item.startTime);
      return itemDay === dayIdx;
    });
    const fixedMs = fixedOnDay.reduce((sum, item) => {
      const dur = item.endTime.getTime() - item.startTime.getTime();
      return sum + dur;
    }, 0);
    const remainingCapMs = Math.max(0, dayCapMs - fixedMs);

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

    if (!placement) {
      // DROPPED: no slot available
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "DROPPED",
        before: {
          dayIndex: item.dayIndex,
          startTime: item.startTime.toISOString(),
          endTime: item.endTime.toISOString(),
        },
        after: null,
      });
      warnings.push({
        itemId: item.id,
        sessionId: item.sessionId,
        code: "DROPPED",
        message: `No available slot for ${item.mode} session (${item.plannedMinutes}min)`,
      });
      continue;
    }

    const newStart = new Date(placement.start);
    const newEnd = new Date(placement.end);
    const newDayIndex = dayIndexFromTime(planStartDate, newStart);

    // Check if position actually changed
    const startChanged = Math.abs(item.startTime.getTime() - newStart.getTime()) > 1000;
    const endChanged = Math.abs(item.endTime.getTime() - newEnd.getTime()) > 1000;

    if (startChanged || endChanged) {
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "MOVED",
        before: {
          dayIndex: item.dayIndex,
          startTime: item.startTime.toISOString(),
          endTime: item.endTime.toISOString(),
        },
        after: {
          dayIndex: newDayIndex,
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
        },
      });
    } else {
      changes.push({
        itemId: item.id,
        sessionId: item.sessionId,
        action: "KEPT",
        before: {
          dayIndex: item.dayIndex,
          startTime: item.startTime.toISOString(),
          endTime: item.endTime.toISOString(),
        },
        after: {
          dayIndex: item.dayIndex,
          startTime: item.startTime.toISOString(),
          endTime: item.endTime.toISOString(),
        },
      });
    }
  }

  return { changes, warnings, algorithmVersion: ALGORITHM_VERSION };
}
