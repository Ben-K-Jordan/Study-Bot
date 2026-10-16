/**
 * Which course Study and Study guides open on when the student hasn't
 * chosen one: the course with today's session, else the one whose exam is
 * nearest. Pure (no React, no database), so the page can work it out on the
 * server from the plans the shell already reads. The browser matches the
 * result against the student's courses in use-preferred-course.ts.
 */
import { dayKey } from "@/lib/timezone"
import { todayPlan, type PlanLike } from "@/lib/home-model"

export interface CoursePreference {
  courseName: string
  examName: string | null
}

/**
 * Courses in the order they should be preferred: the course of the session
 * the Start button opens today (or one left under way), then every course
 * with an exam ahead, nearest exam first. Each course and exam once.
 */
export function coursePreferences(
  plans: readonly PlanLike[],
  timeZone: string,
  now: Date = new Date(),
): CoursePreference[] {
  const preferences: CoursePreference[] = []
  const add = (courseName: string, examName: string | null) => {
    if (!preferences.some((p) => p.courseName === courseName && p.examName === examName)) {
      preferences.push({ courseName, examName })
    }
  }

  const { current } = todayPlan(plans, timeZone, now)
  if (current) add(current.courseName, current.examName)

  const todayKey = dayKey(now, timeZone)
  const upcoming = plans
    .filter((plan) => plan.examDateKey >= todayKey)
    .toSorted((a, b) =>
      a.examDateKey === b.examDateKey
        ? a.courseName.localeCompare(b.courseName)
        : a.examDateKey < b.examDateKey
          ? -1
          : 1,
    )
  for (const plan of upcoming) add(plan.courseName, plan.examName)

  return preferences
}
