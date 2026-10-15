/**
 * What state a plan session is in, from its stored status, its runs and the
 * clock. Pure, so the server and tests derive it the same way.
 *
 * Stored statuses (StudyPlanItem.status): SCHEDULED, IN_PROGRESS, DONE,
 * MISSED, SKIPPED, RESCHEDULED. A session also counts as done when one of its
 * runs completed (a rescheduled item is not marked DONE when its run ends),
 * and as missed when its time passed without being started.
 */

export type PlanItemState = "done" | "in_progress" | "missed" | "skipped" | "scheduled";

/** What the session's runs say: none started, one under way, or one finished. */
export type RunState = "none" | "in_progress" | "completed";

/** Fold a session's run statuses (CREATED, ACTIVE, PAUSED, COMPLETED) into one state. */
export function runStateFromStatuses(statuses: readonly string[]): RunState {
  if (statuses.includes("COMPLETED")) return "completed";
  if (statuses.some((s) => s === "ACTIVE" || s === "PAUSED")) return "in_progress";
  return "none";
}

/** YYYY-MM-DD of an instant in a timezone. */
function dayIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * A session's state. One that was never started counts as missed once its
 * time has passed; with `timeZone`, only once its day has ended there, so a
 * 2 PM session can still be done that evening.
 */
export function classifyPlanItem(
  item: { status: string; endTime: Date | string },
  runState: RunState,
  now: Date,
  timeZone?: string | null,
): PlanItemState {
  if (item.status === "SKIPPED") return "skipped";
  if (item.status === "DONE" || runState === "completed") return "done";
  if (item.status === "IN_PROGRESS" || runState === "in_progress") return "in_progress";
  if (item.status === "MISSED") return "missed";
  const end = item.endTime instanceof Date ? item.endTime : new Date(item.endTime);
  if (end.getTime() > now.getTime()) return "scheduled";
  if (timeZone) {
    try {
      if (dayIn(end, timeZone) === dayIn(now, timeZone)) return "scheduled";
    } catch {
      // An unknown zone falls back to the plain time check
    }
  }
  return "missed";
}

export interface PlanItemCounts {
  /** Every session except skipped ones. */
  total: number;
  done: number;
  in_progress: number;
  missed: number;
  scheduled: number;
  skipped: number;
}

export function countPlanItems(states: readonly PlanItemState[]): PlanItemCounts {
  const counts: PlanItemCounts = {
    total: 0,
    done: 0,
    in_progress: 0,
    missed: 0,
    scheduled: 0,
    skipped: 0,
  };
  for (const state of states) {
    counts[state]++;
    if (state !== "skipped") counts.total++;
  }
  return counts;
}
