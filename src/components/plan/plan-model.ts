/**
 * Pure helpers that turn a plan into what the Plan screen draws: the agenda
 * of dated days (with the exam day in date order), plan ordering, and the
 * labels for modes and states. No React, so the server page and the tests
 * share them.
 */
import {
  calendarDay,
  formatCountdown,
  formatDateWeekday,
  formatRelativeDay,
  plural,
  type DateInput,
} from "@/lib/format"
import { MODE_LABELS, modeLabel as sharedModeLabel } from "@/lib/modes"
import type { PlanItemState } from "@/lib/plan-status"
import type { PlanSummary, PlanView, PlanViewItem } from "@/services/plan"

export type { PlanSummary, PlanView, PlanViewItem }

/** Mode names from VOICE.md (sentence case), shared with the rest of the app. */
export { MODE_LABELS }

export function modeLabel(mode: string): string {
  return sharedModeLabel(mode)
}

/** What a row shows: the stored state, with today's scheduled sessions called out. */
export type SessionDisplay = Exclude<PlanItemState, "scheduled"> | "today" | "scheduled"

export interface AgendaSession {
  item: PlanViewItem
  display: SessionDisplay
  /** Lands after the exam day. */
  afterExam: boolean
}

export interface AgendaDay {
  /** YYYY-MM-DD in the display time zone. */
  key: string
  isToday: boolean
  isPast: boolean
  isExamDay: boolean
  sessions: AgendaSession[]
}

export interface Agenda {
  /** Leading past days whose sessions are all done or skipped (shown collapsed). */
  earlier: AgendaDay[]
  /** Every other day, in date order, the exam day included. */
  days: AgendaDay[]
}

/** The calendar day (YYYY-MM-DD) a moment falls on in `timeZone`. */
export function keyOf(value: DateInput, timeZone: string): string {
  const { year, month, day } = calendarDay(value, timeZone)
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

/** A Date that formats as calendar day `key` when formatted in UTC. */
export function dayKeyToDate(key: string): Date {
  return new Date(`${key}T12:00:00.000Z`)
}

/**
 * Group a plan's sessions by the day they fall on in `timeZone`, place the
 * exam day in date order (with or without sessions), and fold the leading
 * run of finished past days into `earlier`.
 */
export function buildAgenda(
  view: Pick<PlanView, "items" | "exam_date">,
  { timeZone, now = new Date() }: { timeZone: string; now?: Date }
): Agenda {
  const todayKey = keyOf(now, timeZone)
  const examKey = view.exam_date
  const byDay = new Map<string, AgendaSession[]>()

  const sorted = [...view.items].sort(
    (a, b) => Date.parse(a.start_time) - Date.parse(b.start_time)
  )
  for (const item of sorted) {
    const key = keyOf(item.start_time, timeZone)
    const display: SessionDisplay =
      item.state === "scheduled" && key === todayKey ? "today" : item.state
    const list = byDay.get(key) ?? []
    list.push({ item, display, afterExam: key > examKey })
    byDay.set(key, list)
  }
  if (!byDay.has(examKey)) byDay.set(examKey, [])

  const all: AgendaDay[] = [...byDay.keys()].sort().map((key) => ({
    key,
    isToday: key === todayKey,
    isPast: key < todayKey,
    isExamDay: key === examKey,
    sessions: byDay.get(key) ?? [],
  }))

  let split = 0
  while (
    split < all.length &&
    all[split].isPast &&
    !all[split].isExamDay &&
    all[split].sessions.length > 0 &&
    all[split].sessions.every((s) => s.display === "done" || s.display === "skipped")
  ) {
    split++
  }

  return { earlier: all.slice(0, split), days: all.slice(split) }
}

/**
 * Plans in the order the student needs them: upcoming exams soonest first,
 * then past exams, most recent first.
 */
export function sortPlans<T extends Pick<PlanSummary, "exam_date" | "created_at">>(
  plans: readonly T[],
  { timeZone, now = new Date() }: { timeZone: string; now?: Date }
): T[] {
  const todayKey = keyOf(now, timeZone)
  const upcoming = plans
    .filter((p) => p.exam_date >= todayKey)
    .sort((a, b) => a.exam_date.localeCompare(b.exam_date) || b.created_at.localeCompare(a.created_at))
  const past = plans
    .filter((p) => p.exam_date < todayKey)
    .sort((a, b) => b.exam_date.localeCompare(a.exam_date) || b.created_at.localeCompare(a.created_at))
  return [...upcoming, ...past]
}

/** Whole days from today until the exam (negative once it has passed). */
export function daysUntilExam(examDate: string, timeZone: string, now: Date = new Date()): number {
  // The exam date is a calendar day; compare it with today's date in the zone.
  const todayKey = keyOf(now, timeZone)
  return Math.round((Date.parse(examDate) - Date.parse(todayKey)) / 86_400_000)
}

/** Formats a calendar-day key with any format.ts helper, independent of zone. */
export const DAY_KEY_ZONE = "UTC"

export function planName(plan: Pick<PlanSummary, "course_name" | "exam_name">): string {
  return `${plan.course_name} ${plan.exam_name}`
}

/** Whether rescheduling has anything to do: the exam is ahead and sessions can move. */
export function canReschedule(
  view: Pick<PlanView, "counts" | "exam_date">,
  timeZone: string,
  now: Date = new Date()
): boolean {
  if (daysUntilExam(view.exam_date, timeZone, now) <= 0) return false
  return view.counts.missed + view.counts.scheduled > 0
}

/** Same-course-and-exam match for "Replace plan" (case and spacing ignored). */
export function samePlanTarget(
  a: { course_name: string; exam_name: string },
  b: { course_name: string; exam_name: string }
): boolean {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase()
  return norm(a.course_name) === norm(b.course_name) && norm(a.exam_name) === norm(b.exam_name)
}

// Calendar-day keys (YYYY-MM-DD) are zone-free: format them at noon UTC in
// UTC so every zone reads the same day.

/** "Thu, Oct 22" for a calendar-day key. */
export function formatDayKey(key: string): string {
  return formatDateWeekday(dayKeyToDate(key), { timeZone: DAY_KEY_ZONE })
}

/** "Prelim 2 is in 7 days" (or today, tomorrow, was 2 days ago). */
export function examCountdown(examName: string, examKey: string, todayKey: string): string {
  return formatCountdown(examName, dayKeyToDate(examKey), {
    timeZone: DAY_KEY_ZONE,
    now: dayKeyToDate(todayKey),
  })
}

/** "in 7 days", "tomorrow", "today", "2 days ago". */
export function examRelative(examKey: string, todayKey: string): string {
  return formatRelativeDay(dayKeyToDate(examKey), {
    timeZone: DAY_KEY_ZONE,
    now: dayKeyToDate(todayKey),
  })
}

/** "3 sessions move and 5 stay. 2 don't fit before Prelim 1 and will be skipped." */
export function previewSentence(
  summary: { moved: number; kept: number; dropped: number },
  examName: string
): string {
  const { moved, kept, dropped } = summary
  const parts: string[] = []
  if (moved > 0 || kept > 0) {
    const move = plural(moved, { zero: "No sessions move", one: "# session moves", other: "# sessions move" })
    const stay = kept > 0 ? ` and ${plural(kept, { one: "# stays", other: "# stay" })}` : ""
    parts.push(`${move}${stay}.`)
  }
  if (dropped > 0) {
    parts.push(
      plural(dropped, {
        one: `# doesn't fit before ${examName} and will be skipped.`,
        other: `# don't fit before ${examName} and will be skipped.`,
      })
    )
  }
  return parts.join(" ")
}

/** What POST /api/plans/{id}/reflow/apply returns, as the Plan screen reads it. */
export interface RescheduleApplyResult {
  applied: boolean
  summary?: { moved: number; dropped: number }
  calendar: { status?: string; code?: string; error?: string } | null
}

/**
 * The toast after Move: what moved and what was skipped, then one sentence
 * on Google Calendar with the way to fix it when it wasn't updated.
 */
export function rescheduleToast(result: RescheduleApplyResult): {
  title: string
  description?: string
  calendarAction?: "update" | "reconnect"
} {
  if (!result.applied) return { title: "Nothing to reschedule" }
  const moved = result.summary?.moved ?? 0
  const dropped = result.summary?.dropped ?? 0
  const title =
    moved > 0 && dropped > 0
      ? plural(moved, { one: "# session moved", other: "# sessions moved" }) +
        plural(dropped, { one: " and # skipped", other: " and # skipped" })
      : moved > 0
        ? plural(moved, { one: "# session moved", other: "# sessions moved" })
        : plural(dropped, { one: "# session skipped", other: "# sessions skipped" })

  const status = result.calendar?.status
  const code = result.calendar?.code
  if (status === "OK") return { title, description: "Google Calendar updated." }
  if (status === "PARTIAL") {
    return {
      title,
      description: "Some Google Calendar events weren't updated. Update them from the plan menu.",
      calendarAction: "update",
    }
  }
  if (status === "FAILED") {
    if (code === "GOOGLE_RECONNECT_REQUIRED" || code === "GOOGLE_NOT_CONNECTED") {
      return {
        title,
        description: "Google Calendar wasn't updated because it needs you to sign in again.",
        calendarAction: "reconnect",
      }
    }
    return {
      title,
      description: "Google Calendar wasn't updated. Update it from the plan menu.",
      calendarAction: "update",
    }
  }
  return { title }
}
