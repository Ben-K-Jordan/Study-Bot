/**
 * Home's exam countdowns and today's sessions: every "today" is the
 * student's day, whatever zone the server runs in.
 */
import { describe, expect, it } from "vitest"

import { examCountdowns, examInstant, missedItems, todayPlan, type PlanLike } from "@/components/home/home-model"
import { statItems } from "@/components/home/stat-items"
import { daysUntil } from "@/lib/format"

const ZONE = "America/New_York"
// 9:30pm on Thursday Oct 15 in New York, already Friday Oct 16 in UTC.
const NOW = new Date("2026-10-16T01:30:00Z")

function item(id: string, start: string, minutes: number, status = "SCHEDULED") {
  const startTime = new Date(start)
  return {
    id,
    sessionId: `s-${id}`,
    startTime,
    endTime: new Date(startTime.getTime() + minutes * 60_000),
    status,
  }
}

function plan(overrides: Partial<PlanLike> = {}): PlanLike {
  return {
    planId: "p1",
    courseName: "INFO 1300",
    examName: "Prelim 2",
    examDateKey: "2026-10-22",
    items: [],
    lastRescheduledAt: null,
    ...overrides,
  }
}

describe("examInstant", () => {
  it("counts whole days to the exam's calendar date in the student's zone", () => {
    // A @db.Date exam stored as 2026-10-22T00:00Z is Oct 21 at 8pm in New
    // York; read naively it would count one day short.
    expect(daysUntil(new Date("2026-10-22T00:00:00Z"), { timeZone: ZONE, now: NOW })).toBe(6)
    expect(daysUntil(examInstant("2026-10-22", ZONE), { timeZone: ZONE, now: NOW })).toBe(7)
  })
})

describe("examCountdowns", () => {
  it("lists upcoming exams nearest first and drops past ones", () => {
    const exams = examCountdowns(
      [
        plan({ planId: "later", examDateKey: "2026-12-14", courseName: "ECON 1110", examName: "Final" }),
        plan({ planId: "past", examDateKey: "2026-10-14" }),
        plan({ planId: "soon", examDateKey: "2026-10-22" }),
        plan({ planId: "today", examDateKey: "2026-10-15", courseName: "AEM 2210", examName: "Quiz" }),
      ],
      ZONE,
      NOW
    )
    expect(exams.map((e) => e.planId)).toEqual(["today", "soon", "later"])
  })

  it("counts done and total sessions, leaving skipped ones out", () => {
    const [exam] = examCountdowns(
      [
        plan({
          items: [
            item("a", "2026-10-13T18:00:00Z", 30, "DONE"),
            item("b", "2026-10-14T18:00:00Z", 30, "SKIPPED"),
            item("c", "2026-10-20T18:00:00Z", 30),
          ],
        }),
      ],
      ZONE,
      NOW
    )
    expect(exam).toMatchObject({ sessionsDone: 1, sessionsTotal: 2 })
  })
})

describe("missedItems", () => {
  it("counts sessions marked missed and scheduled ones whose day has ended", () => {
    const p = plan({
      items: [
        item("missed", "2026-10-13T18:00:00Z", 30, "MISSED"),
        item("stale", "2026-10-14T18:00:00Z", 30), // yesterday, never started
        item("tonight", "2026-10-15T23:00:00Z", 30), // 7pm today in New York
      ],
    })
    expect(missedItems(p, "2026-10-15", ZONE).map((i) => i.id)).toEqual(["missed", "stale"])
  })

  it("stops counting a missed session once the plan is rescheduled after it", () => {
    const p = plan({
      items: [item("missed", "2026-10-13T18:00:00Z", 30, "MISSED")],
      lastRescheduledAt: new Date("2026-10-14T12:00:00Z"),
    })
    expect(missedItems(p, "2026-10-15", ZONE)).toEqual([])
  })
})

describe("todayPlan", () => {
  it("uses the student's day, not the UTC day", () => {
    // 7pm Oct 15 in New York is Oct 16 in UTC: still today for the student.
    const tonight = item("tonight", "2026-10-15T23:00:00Z", 30)
    // 10am Oct 16 in New York: tomorrow.
    const tomorrow = item("tomorrow", "2026-10-16T14:00:00Z", 30)
    const result = todayPlan([plan({ items: [tomorrow, tonight] })], ZONE, NOW)
    expect(result.today.map((i) => i.id)).toEqual(["tonight"])
    expect(result.current?.id).toBe("tonight")
    expect(result.next).toBeNull()
  })

  it("offers the next scheduled session when nothing is open today", () => {
    const done = item("done", "2026-10-15T18:00:00Z", 30, "DONE")
    const next = item("next", "2026-10-17T14:00:00Z", 30)
    const result = todayPlan([plan({ items: [next, done] })], ZONE, NOW)
    expect(result.current).toBeNull()
    expect(result.today.map((i) => i.id)).toEqual(["done"])
    expect(result.next?.id).toBe("next")
  })

  it("puts a session left in progress on an earlier day first", () => {
    const carried = item("carried", "2026-10-14T18:00:00Z", 30, "IN_PROGRESS")
    const later = item("later", "2026-10-15T23:00:00Z", 30)
    const result = todayPlan([plan({ items: [later, carried] })], ZONE, NOW)
    expect(result.current?.id).toBe("carried")
  })
})

describe("statItems", () => {
  const week = { answers: 0, correct: 0, answeringSeconds: 0, plannedMinutes: 0, sessions: 0 }

  it("reports accuracy and the time spent answering", () => {
    const items = statItems(4, { ...week, answers: 49, correct: 29, answeringSeconds: 4419, sessions: 5 })
    expect(items.map((i) => [i.value, i.label])).toEqual([
      ["4-day streak", undefined],
      ["59%", "accuracy, last 7 days"],
      ["74 min", "answering questions, last 7 days"],
    ])
  })

  it("labels planned minutes honestly when sessions have no answer timers", () => {
    const items = statItems(0, { ...week, answers: 10, correct: 5, plannedMinutes: 30, sessions: 1 })
    expect(items[0].value).toBe("No current streak")
    expect(items[2]).toMatchObject({ value: "30 min", label: "of completed sessions, last 7 days" })
  })

  it("says so when there are no answers instead of showing a dash", () => {
    const items = statItems(1, week)
    expect(items.map((i) => i.value)).toEqual(["1-day streak", "No answers in the last 7 days"])
  })
})
