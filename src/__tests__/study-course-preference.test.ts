/**
 * Which course Study and Study guides open on when the student hasn't
 * chosen one (today's session, else the nearest exam, never just the latest
 * upload), and the "Planned for today" line when nothing is left to start.
 */
import { describe, expect, it } from "vitest"

import type { PlanLike } from "@/lib/home-model"
import { coursePreferences } from "@/components/study/course-preference"
import { nothingLeftTodayLine } from "@/lib/study-copy"
import { preferredCourseKey } from "@/components/study/use-preferred-course"

const ZONE = "America/New_York"
// 9:30pm on Thursday Oct 15 in New York, already Friday Oct 16 in UTC.
const NOW = new Date("2026-10-16T01:30:00Z")

function item(id: string, start: string, status = "SCHEDULED") {
  const startTime = new Date(start)
  return { id, sessionId: `s-${id}`, startTime, endTime: new Date(startTime.getTime() + 30 * 60_000), status }
}

function plan(courseName: string, examName: string, examDateKey: string, items: PlanLike["items"] = []): PlanLike {
  return { planId: `${courseName} ${examName}`, courseName, examName, examDateKey, items, lastRescheduledAt: null }
}

describe("coursePreferences", () => {
  it("puts the course with today's open session first, then exams nearest first", () => {
    const plans = [
      plan("ECON 1110", "Final", "2026-12-14"),
      plan("CS 2110", "Prelim 1", "2026-10-20"),
      // 10:30pm Oct 15 in New York: still today there.
      plan("INFO 1300", "Prelim 2", "2026-10-22", [item("a", "2026-10-16T02:30:00Z")]),
    ]
    expect(coursePreferences(plans, ZONE, NOW)).toEqual([
      { courseName: "INFO 1300", examName: "Prelim 2" },
      { courseName: "CS 2110", examName: "Prelim 1" },
      { courseName: "ECON 1110", examName: "Final" },
    ])
  })

  it("falls back to the nearest exam when today's sessions are done, and drops exams that have passed", () => {
    const plans = [
      plan("INFO 1300", "Prelim 2", "2026-10-22", [item("a", "2026-10-15T14:00:00Z", "DONE")]),
      plan("CS 2110", "Prelim 1", "2026-10-20"),
      plan("BIO 1010", "Prelim 1", "2026-10-14"),
    ]
    expect(coursePreferences(plans, ZONE, NOW)).toEqual([
      { courseName: "CS 2110", examName: "Prelim 1" },
      { courseName: "INFO 1300", examName: "Prelim 2" },
    ])
  })

  it("is empty without plans", () => {
    expect(coursePreferences([], ZONE, NOW)).toEqual([])
  })
})

describe("preferredCourseKey", () => {
  // Ordered as the course switcher lists them: the latest upload first.
  const keys = ["ECON 1110||Final", "INFO 1300||Prelim 2", "CS 2110"]

  it("picks the first preference the student has materials for", () => {
    expect(
      preferredCourseKey(keys, [
        { courseName: "MATH 1920", examName: "Prelim 1" },
        { courseName: "INFO 1300", examName: "Prelim 2" },
        { courseName: "ECON 1110", examName: "Final" },
      ]),
    ).toBe("INFO 1300||Prelim 2")
  })

  it("matches materials filed under the course alone", () => {
    expect(preferredCourseKey(keys, [{ courseName: "CS 2110", examName: "Prelim 1" }])).toBe("CS 2110")
  })

  it("returns null when no preference has materials, so the first course stays the default", () => {
    expect(preferredCourseKey(keys, [{ courseName: "MATH 1920", examName: "Final" }])).toBeNull()
    expect(preferredCourseKey(keys, [])).toBeNull()
  })
})

describe("nothingLeftTodayLine", () => {
  const next = "Retrieval, Wed, Oct 21 at 11:00 AM"

  it("says no sessions today when none were planned today", () => {
    expect(nothingLeftTodayLine("ECON 1110", { planned: 0, done: 0 }, next)).toBe(
      "No ECON 1110 sessions today. Next: Retrieval, Wed, Oct 21 at 11:00 AM.",
    )
  })

  it("says today's sessions are done when every one is done", () => {
    expect(nothingLeftTodayLine("ECON 1110", { planned: 1, done: 1 }, next)).toBe(
      "Today's ECON 1110 session is done. Next: Retrieval, Wed, Oct 21 at 11:00 AM.",
    )
    expect(nothingLeftTodayLine("ECON 1110", { planned: 2, done: 2 }, null)).toBe(
      "Today's ECON 1110 sessions are done, and nothing else is scheduled.",
    )
  })

  it("says none are left when today's were missed or skipped", () => {
    expect(nothingLeftTodayLine("ECON 1110", { planned: 2, done: 1 }, next)).toBe(
      "No ECON 1110 sessions left today. Next: Retrieval, Wed, Oct 21 at 11:00 AM.",
    )
  })

  it("says the plan has nothing more when nothing comes next", () => {
    expect(nothingLeftTodayLine("ECON 1110", { planned: 0, done: 0 }, null)).toBe(
      "No more sessions planned for ECON 1110.",
    )
  })

  it("keeps a # in the course name", () => {
    expect(nothingLeftTodayLine("C# 101", { planned: 1, done: 1 }, null)).toBe(
      "Today's C# 101 session is done, and nothing else is scheduled.",
    )
  })
})
