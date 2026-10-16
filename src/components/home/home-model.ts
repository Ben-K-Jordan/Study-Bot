/**
 * Pure derivations for Home: exam countdowns and today's sessions, all in
 * the student's time zone. Unit-tested in src/__tests__/home-model.test.ts.
 */
import { addDays, dayKey, zonedTimeToUtc } from "@/lib/timezone"

export interface ItemLike {
  id: string
  sessionId: string
  startTime: Date
  endTime: Date
  status: string
}

export interface PlanLike<I extends ItemLike = ItemLike> {
  planId: string
  courseName: string
  examName: string
  examDateKey: string
  items: readonly I[]
  lastRescheduledAt: Date | null
}

export interface ExamCountdown {
  planId: string
  courseName: string
  examName: string
  /** Noon on the exam day in the student's zone, so day counts are exact. */
  examDate: string
  sessionsDone: number
  sessionsTotal: number
  missedCount: number
}

/**
 * Stored statuses of a session nobody has started yet. A session moved by
 * Reschedule becomes RESCHEDULED and is still to do, as Plan and the run
 * service treat it (src/services/reflow.ts isMissedItem, run.ts).
 */
export function isUnstartedPlanStatus(status: string): boolean {
  return status === "SCHEDULED" || status === "RESCHEDULED"
}

/** Stored statuses of a session the student can start or resume. */
export function isOpenPlanStatus(status: string): boolean {
  return isUnstartedPlanStatus(status) || status === "IN_PROGRESS"
}

/** The exam day as an instant that falls on that calendar day in `timeZone`. */
export function examInstant(examDateKey: string, timeZone: string): Date {
  return zonedTimeToUtc(examDateKey, "12:00", timeZone)
}

/**
 * Sessions that slipped and haven't been rescheduled since: marked missed,
 * or never started on a day that has ended (rescheduled ones included). A
 * reschedule after the session's start time means the student already
 * dealt with it.
 */
export function missedItems<I extends ItemLike>(
  plan: PlanLike<I>,
  todayKey: string,
  timeZone: string
): I[] {
  return plan.items.filter((item) => {
    const slipped =
      item.status === "MISSED" ||
      (isUnstartedPlanStatus(item.status) && dayKey(item.endTime, timeZone) < todayKey)
    if (!slipped) return false
    return !plan.lastRescheduledAt || item.startTime > plan.lastRescheduledAt
  })
}

/** Upcoming exams, nearest first. Exams that have passed drop off Home. */
export function examCountdowns(
  plans: readonly PlanLike[],
  timeZone: string,
  now: Date
): ExamCountdown[] {
  const todayKey = dayKey(now, timeZone)
  return plans
    .filter((plan) => plan.examDateKey >= todayKey)
    .sort((a, b) =>
      a.examDateKey === b.examDateKey
        ? a.courseName.localeCompare(b.courseName)
        : a.examDateKey < b.examDateKey
          ? -1
          : 1
    )
    .map((plan) => {
      const counted = plan.items.filter((i) => i.status !== "SKIPPED")
      return {
        planId: plan.planId,
        courseName: plan.courseName,
        examName: plan.examName,
        examDate: examInstant(plan.examDateKey, timeZone).toISOString(),
        sessionsDone: counted.filter((i) => i.status === "DONE").length,
        sessionsTotal: counted.length,
        missedCount: missedItems(plan, todayKey, timeZone).length,
      }
    })
}

export interface ScheduledItem {
  id: string
  sessionId: string
  planId: string
  courseName: string
  examName: string
  startTime: string
  endTime: string
  status: string
}

export interface TodayPlan {
  /** Every session on today's date, by start time. */
  today: ScheduledItem[]
  /** The session to start now: the first open one today. */
  current: ScheduledItem | null
  /** When nothing is open today: the next unstarted session after today. */
  next: ScheduledItem | null
}

export function todayPlan(plans: readonly PlanLike[], timeZone: string, now: Date): TodayPlan {
  const todayKey = dayKey(now, timeZone)
  const all: ScheduledItem[] = []
  for (const plan of plans) {
    for (const item of plan.items) {
      all.push({
        id: item.id,
        sessionId: item.sessionId,
        planId: plan.planId,
        courseName: plan.courseName,
        examName: plan.examName,
        startTime: item.startTime.toISOString(),
        endTime: item.endTime.toISOString(),
        status: item.status,
      })
    }
  }
  all.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0))

  const today = all.filter((i) => dayKey(new Date(i.startTime), timeZone) === todayKey)
  // A session left open from an earlier day is resumable, so it comes first.
  const carriedOver = all.find(
    (i) => i.status === "IN_PROGRESS" && dayKey(new Date(i.startTime), timeZone) < todayKey
  )
  const current = carriedOver ?? today.find((i) => isOpenPlanStatus(i.status)) ?? null
  const tomorrowKey = addDays(todayKey, 1)
  const next = current
    ? null
    : (all.find(
        (i) => isUnstartedPlanStatus(i.status) && dayKey(new Date(i.startTime), timeZone) >= tomorrowKey
      ) ?? null)
  return { today, current, next }
}
