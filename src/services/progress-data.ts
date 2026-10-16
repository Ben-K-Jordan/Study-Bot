/**
 * Server-side reads shared by Home and Progress. Server Components only:
 * `server-only` makes a client import fail the build instead of pulling
 * Prisma into the browser bundle. Each loader is wrapped in React.cache so a
 * page that asks for the same data in several sections queries once per
 * request, and callers can start loaders early (call without awaiting) to
 * avoid waterfalls.
 *
 * Read-only: nothing here writes.
 */
import "server-only"

import { cache } from "react"
import { redirect } from "next/navigation"

import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { addDays, dayKey, zonedTimeToUtc } from "@/lib/timezone"
import { logger } from "@/lib/logger"
import { pretestKey, splitRatedAnswers, type RatedAnswerLike } from "@/components/progress/progress-model"
import { getActivityByDay, getGameState, resolveTimeZone } from "@/services/gamification"

/** The signed-in student, or a redirect to sign-in. */
export const requireUserId = cache(async (callbackUrl: string): Promise<string> => {
  const userId = await getCurrentUserId()
  if (!userId) redirect(`/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}`)
  return userId
})

/** The zone that decides "today" for this student (see resolveTimeZone). */
export const loadTimeZone = cache((userId: string) => resolveTimeZone(userId))

export const loadGameState = cache((userId: string) => getGameState(userId))

export interface PlanItemRow {
  id: string
  sessionId: string
  startTime: Date
  endTime: Date
  /**
   * The stored status, except that a session with a run under way reads
   * IN_PROGRESS (starting a run doesn't write the item), as Plan shows it.
   */
  status: string
  completedAt: Date | null
}

export interface PlanRow {
  planId: string
  courseName: string
  examName: string
  /** The exam's calendar date, YYYY-MM-DD. */
  examDateKey: string
  createdAt: Date
  /** Topic titles the plan was made from. */
  topics: string[]
  items: PlanItemRow[]
  /** When the plan was last rescheduled, if ever. */
  lastRescheduledAt: Date | null
}

function topicsFromConfig(config: unknown): string[] {
  const objectives = (config as { objectives?: unknown } | null)?.objectives
  if (!Array.isArray(objectives)) return []
  return objectives.filter((o): o is string => typeof o === "string" && o.trim().length > 0)
}

export const loadPlans = cache(async (userId: string): Promise<PlanRow[]> => {
  const [plans, audits, openRuns] = await Promise.all([
    prisma.studyPlan.findMany({
      where: { userId },
      orderBy: [{ examDate: "asc" }, { createdAt: "desc" }],
      take: 50,
      select: {
        planId: true,
        courseName: true,
        examName: true,
        examDate: true,
        createdAt: true,
        config: true,
        items: {
          orderBy: { startTime: "asc" },
          select: {
            id: true,
            sessionId: true,
            startTime: true,
            endTime: true,
            status: true,
            completedAt: true,
          },
        },
      },
    }),
    prisma.planReflowAudit.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { planId: true, createdAt: true },
      take: 200,
    }),
    // Runs under way (the same statuses Plan counts as in progress)
    prisma.sessionRun.findMany({
      where: { userId, status: { in: ["ACTIVE", "PAUSED"] } },
      select: { sessionId: true },
    }),
  ])
  const underWay = new Set(openRuns.map((run) => run.sessionId))

  const lastReflow = new Map<string, Date>()
  for (const audit of audits) {
    if (!lastReflow.has(audit.planId)) lastReflow.set(audit.planId, audit.createdAt)
  }

  return plans.map((plan) => ({
    planId: plan.planId,
    courseName: plan.courseName,
    examName: plan.examName,
    // @db.Date columns arrive as UTC midnight: the key is the calendar date.
    examDateKey: plan.examDate.toISOString().slice(0, 10),
    createdAt: plan.createdAt,
    topics: topicsFromConfig(plan.config),
    items: plan.items.map((item) =>
      item.status !== "DONE" && underWay.has(item.sessionId) ? { ...item, status: "IN_PROGRESS" } : item
    ),
    lastRescheduledAt: lastReflow.get(plan.planId) ?? null,
  }))
})

export interface SessionInfo {
  sessionId: string
  mode: string
  topicScope: string
  topics: string[]
  plannedMinutes: number
}

function topicsFromObjectives(objectives: unknown, fallback: string): string[] {
  if (Array.isArray(objectives)) {
    const titles = objectives
      .map((o) => (o && typeof o === "object" ? (o as { title?: unknown }).title : undefined))
      .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
    if (titles.length > 0) return titles
  }
  return fallback ? [fallback] : []
}

/** Session details for plan items. `ids` is a sorted, comma-joined key so the cache can match it. */
const loadSessionsByKey = cache(async (userId: string, idsKey: string): Promise<Map<string, SessionInfo>> => {
  const ids = idsKey ? idsKey.split(",") : []
  if (ids.length === 0) return new Map()
  const sessions = await prisma.session.findMany({
    where: { userId, sessionId: { in: ids } },
    select: { sessionId: true, mode: true, topicScope: true, objectives: true, plannedMinutes: true },
  })
  return new Map(
    sessions.map((s) => [
      s.sessionId,
      {
        sessionId: s.sessionId,
        mode: s.mode,
        topicScope: s.topicScope,
        topics: topicsFromObjectives(s.objectives, s.topicScope),
        plannedMinutes: s.plannedMinutes,
      },
    ])
  )
})

export function loadSessions(userId: string, ids: readonly string[]) {
  return loadSessionsByKey(userId, [...new Set(ids)].sort().join(","))
}

export const loadMastery = cache(async (userId: string) =>
  prisma.objectiveMastery.findMany({
    where: { userId },
    select: {
      courseName: true,
      objectiveKey: true,
      lastAccuracy: true,
      repetitions: true,
      easeFactor: true,
      lastStudiedAt: true,
      nextDueAt: true,
    },
  })
)

export interface CourseErrors {
  courseName: string
  /** Exam named on the sessions the errors came from, newest first. */
  examName: string
  count: number
  /** Errors logged with the answer marked Sure. */
  sureCount: number
}

export const loadUnresolvedErrors = cache(async (userId: string): Promise<CourseErrors[]> => {
  const errors = await prisma.sessionErrorLog.findMany({
    where: { userId, resolvedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      confidenceRating: true,
      run: { select: { session: { select: { courseName: true, examName: true } } } },
    },
  })
  const byCourse = new Map<string, CourseErrors>()
  for (const e of errors) {
    const { courseName, examName } = e.run.session
    let entry = byCourse.get(courseName)
    if (!entry) {
      entry = { courseName, examName, count: 0, sureCount: 0 }
      byCourse.set(courseName, entry)
    }
    entry.count += 1
    if ((e.confidenceRating ?? 0) >= 4) entry.sureCount += 1
  }
  return [...byCourse.values()].sort((a, b) => b.count - a.count || a.courseName.localeCompare(b.courseName))
})

export const loadMaterialCount = cache((userId: string) =>
  prisma.contentDocument.count({ where: { userId, namespace: "COURSE" } })
)

export interface WeekTotals {
  /** Scored answers (pretest answers excluded, as in session accuracy). */
  answers: number
  correct: number
  /** Time spent answering, from the answer timers. */
  answeringSeconds: number
  /** Planned length of the sessions finished, for runs without timers. */
  plannedMinutes: number
  sessions: number
}

/** Sessions finished in the last 7 days, today included, in the student's zone. */
export const loadLastSevenDays = cache(async (userId: string, timeZone: string): Promise<WeekTotals> => {
  const firstDay = addDays(dayKey(new Date(), timeZone), -6)
  const since = zonedTimeToUtc(firstDay, "00:00", timeZone)
  const runs = await prisma.sessionRun.findMany({
    where: { userId, status: "COMPLETED", endedAt: { gte: since } },
    select: { metrics: true, session: { select: { plannedMinutes: true } } },
  })
  const totals: WeekTotals = { answers: 0, correct: 0, answeringSeconds: 0, plannedMinutes: 0, sessions: 0 }
  for (const run of runs) {
    const m = (run.metrics ?? {}) as {
      attempts_count?: number
      correct_count?: number
      time_spent_seconds?: number
    }
    totals.sessions += 1
    totals.answers += m.attempts_count ?? 0
    totals.correct += m.correct_count ?? 0
    totals.answeringSeconds += m.time_spent_seconds ?? 0
    totals.plannedMinutes += run.session.plannedMinutes
  }
  return totals
})

export type RatedAnswer = RatedAnswerLike

/**
 * Scored answers from the newest 12 weeks: the rated ones, and a count of
 * the unrated ones. Pretest answers are left out, as on the end screen. Runs
 * saved before question rows existed (spring 2026) can't be told apart and
 * count as ordinary questions.
 */
export const loadRatedAnswers = cache(async (userId: string): Promise<{ rated: RatedAnswer[]; unrated: number }> => {
  const since = new Date(Date.now() - 12 * 7 * 86_400_000)
  const scored = { selfScore: { not: null }, createdAt: { gte: since } }
  const [attempts, pretests] = await Promise.all([
    prisma.sessionAttempt.findMany({
      where: { run: { userId }, ...scored },
      select: { runId: true, promptIndex: true, confidenceRating: true, selfScore: true, createdAt: true },
    }),
    prisma.sessionRunPrompt.findMany({
      where: {
        run: { userId, attempts: { some: scored } },
        meta: { path: ["pack"], equals: "PRE_TEST" },
      },
      select: { runId: true, promptIndex: true },
    }),
  ])
  return splitRatedAnswers(attempts, new Set(pretests.map((p) => pretestKey(p.runId, p.promptIndex))))
})

/** The plan for a course whose exam is next, else its newest plan. */
export function examForCourse(plans: readonly PlanRow[], courseName: string, todayKey: string): PlanRow | undefined {
  const forCourse = plans.filter((p) => p.courseName === courseName)
  const upcoming = forCourse
    .filter((p) => p.examDateKey >= todayKey)
    .sort((a, b) => (a.examDateKey < b.examDateKey ? -1 : 1))
  if (upcoming.length > 0) return upcoming[0]
  return forCourse.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
}

/**
 * Runs a section's loader and logs a failure instead of throwing, so one
 * section can show its own error while the rest of the page renders.
 * Returns null when the load failed.
 */
export async function loadSafely<T>(event: string, userId: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (err) {
    logger.error(event, { user_id: userId, error: String(err) })
    return null
  }
}

/** A year of activity (53 weeks, Sunday first) in the student's zone, keyed by day. */
export const loadYearOfActivity = cache(async (userId: string, timeZone: string) => {
  const todayKey = dayKey(new Date(), timeZone)
  const weekday = new Date(`${todayKey}T12:00:00Z`).getUTCDay()
  const sinceKey = addDays(todayKey, -weekday - 52 * 7)
  return { todayKey, days: await getActivityByDay(userId, timeZone, sinceKey) }
})
