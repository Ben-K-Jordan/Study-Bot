/**
 * Progress models: topics and mastery, confidence calibration, the activity
 * heatmap and achievement progress.
 */
import { describe, expect, it } from "vitest"

import {
  achievementViews,
  buildHeatmap,
  calibrate,
  confidenceLevel,
  dayLabel,
  describeDay,
  heatLevel,
  pretestKey,
  splitRatedAnswers,
  weekStart,
} from "@/lib/progress-model"
import {
  buildTopics,
  compareWeakestFirst,
  isWeakTopic,
  topicStatus,
} from "@/components/progress/topics"
import { ALL_BADGES, badgesReached } from "@/lib/badge-data"
import { slugifyObjectiveTitle } from "@/lib/objective-keys"
import type { DayActivity } from "@/services/gamification"

const NOW = new Date("2026-10-15T19:00:00Z")

function day(overrides: Partial<DayActivity> = {}): DayActivity {
  return { sessions: 0, reviews: 0, freezeUsed: false, xp: 0, ...overrides }
}

describe("topics", () => {
  it("titles topics from the plans, falling back to a readable key", () => {
    const topics = buildTopics(
      [
        { courseName: "INFO 1300", objectiveKey: "css_specificity", lastAccuracy: 0.2, repetitions: 0, easeFactor: 1.3, lastStudiedAt: NOW, nextDueAt: null },
        { courseName: "INFO 1300", objectiveKey: "media_queries", lastAccuracy: 0.9, repetitions: 1, easeFactor: 2.5, lastStudiedAt: NOW, nextDueAt: null },
        // A key written outside the plan generator keeps its acronym.
        { courseName: "INFO 1300", objectiveKey: "HTML_forms", lastAccuracy: 0.8, repetitions: 1, easeFactor: 2.5, lastStudiedAt: NOW, nextDueAt: null },
      ],
      [{ courseName: "INFO 1300", titles: ["CSS specificity", "The box model"] }],
      NOW
    )
    expect(topics.map((t) => [t.title, t.status])).toEqual([
      ["CSS specificity", "practiced"],
      ["Media queries", "practiced"],
      ["HTML forms", "practiced"],
      ["The box model", "not-practiced"],
    ])
  })

  it("marks mastered and due topics with the server's rules", () => {
    const base = { lastAccuracy: 1, lastStudiedAt: NOW, nextDueAt: null }
    expect(topicStatus({ ...base, repetitions: 3, easeFactor: 2.1 }, NOW)).toBe("mastered")
    expect(topicStatus({ ...base, repetitions: 1, easeFactor: 2.5, nextDueAt: new Date("2026-10-14T00:00:00Z") }, NOW)).toBe("due")
  })

  it("sorts weakest first with never-practiced topics last, and finds weak spots", () => {
    const t = (title: string, value: number | null, status: "practiced" | "mastered" | "not-practiced" = "practiced") => ({
      courseName: "C",
      key: slugifyObjectiveTitle(title),
      title,
      value,
      status,
      lastStudiedAt: null,
    })
    const sorted = [t("B", 0.5), t("A", null, "not-practiced"), t("C", 0.2), t("D", 0.9)].sort(compareWeakestFirst)
    expect(sorted.map((x) => x.title)).toEqual(["C", "B", "D", "A"])
    expect(isWeakTopic(t("B", 0.5))).toBe(true)
    expect(isWeakTopic(t("D", 0.9))).toBe(false)
    expect(isWeakTopic(t("A", null, "not-practiced"))).toBe(false)
  })
})

describe("calibrate", () => {
  const at = (iso: string) => new Date(iso)
  const answers = [
    { confidence: 5, correct: true, createdAt: at("2026-10-05T18:00:00Z") },
    { confidence: 5, correct: true, createdAt: at("2026-10-06T18:00:00Z") },
    { confidence: 5, correct: false, createdAt: at("2026-10-07T18:00:00Z") }, // incorrect
    { confidence: 4, correct: false, createdAt: at("2026-10-13T18:00:00Z") }, // partly correct
    { confidence: 3, correct: true, createdAt: at("2026-10-13T18:00:00Z") },
    { confidence: 1, correct: true, createdAt: at("2026-10-14T18:00:00Z") },
    { confidence: 2, correct: false, createdAt: at("2026-10-14T18:00:00Z") },
  ]

  it("maps old five-step ratings onto the three levels, as the end screen does", () => {
    // The old 2 was labelled Unsure, and 4 Confident.
    expect([1, 2, 3, 4, 5].map((rating) => confidenceLevel(rating))).toEqual(["guessing", "unsure", "unsure", "sure", "sure"])
  })

  it("summarizes each level and counts over- and underconfidence", () => {
    const result = calibrate(answers, "America/New_York")
    expect(result.levels).toEqual([
      { level: "sure", answers: 4, correct: 2, rate: 0.5 },
      { level: "unsure", answers: 2, correct: 1, rate: 0.5 },
      { level: "guessing", answers: 1, correct: 1, rate: 1 },
    ])
    // Sure and not fully correct, as on the end screen: the incorrect and the partly correct one.
    expect(result.overconfident).toBe(2)
    expect(result.underconfident).toBe(1)
  })

  it("groups answers into Sunday-first weeks in the student's zone", () => {
    const result = calibrate(answers, "America/New_York")
    expect(result.weeks.map((w) => [w.weekKey, w.label, w.answers])).toEqual([
      ["2026-10-04", "Oct 4", 3],
      ["2026-10-11", "Oct 11", 4],
    ])
    expect(result.weeks[0].sure).toBeCloseTo(2 / 3)
    expect(result.weeks[0].unsure).toBeNull()
  })

  it("leaves pretest answers out and counts unrated ones", () => {
    const attempt = (promptIndex: number, confidenceRating: number | null, selfScore: string | null) => ({
      runId: "run-1",
      promptIndex,
      confidenceRating,
      selfScore,
      createdAt: at("2026-10-14T18:00:00Z"),
    })
    const { rated, unrated } = splitRatedAnswers(
      [
        attempt(0, 5, "INCORRECT"), // pretest: wrong answers are expected
        attempt(1, null, "CORRECT"), // pretest, unrated
        attempt(2, 5, "PARTIAL"),
        attempt(3, null, "INCORRECT"),
        attempt(4, 1, null), // not scored yet (exam simulation)
      ],
      new Set([pretestKey("run-1", 0), pretestKey("run-1", 1)])
    )
    expect(rated.map((a) => [a.confidence, a.correct])).toEqual([[5, false]])
    expect(unrated).toBe(1)
  })

  it("finds the week start across a month boundary", () => {
    expect(weekStart("2026-11-03")).toBe("2026-11-01")
    expect(weekStart("2026-11-01")).toBe("2026-11-01")
  })
})

describe("heatmap", () => {
  it("steps darker with XP", () => {
    expect([0, 1, 9, 10, 25, 50].map(heatLevel)).toEqual([0, 1, 1, 2, 3, 4])
  })

  it("describes what a day held, counting sessions and reviews separately", () => {
    expect(describeDay(day({ sessions: 1, reviews: 8, xp: 26 }))).toBe("1 session and 8 card reviews")
    expect(describeDay(day({ reviews: 1, xp: 2 }))).toBe("1 card review")
    expect(describeDay(day({ freezeUsed: true }))).toBe("Streak freeze used")
    // A day with study XP but no session or review (a perfect-deck bonus) still says what it held.
    expect(describeDay(day({ xp: 5 }))).toBe("5 XP")
    expect(describeDay(undefined)).toBe("No study")
  })

  it("ends on today with full weeks before it and nothing after", () => {
    const days = new Map([
      ["2026-10-15", day({ sessions: 1, xp: 10 })],
      ["2026-10-14", day({ reviews: 2, xp: 4 })],
      ["2026-10-12", day({ reviews: 1, xp: 2 })],
    ])
    const map = buildHeatmap(days, "2026-10-15")
    expect(map.columns).toHaveLength(53)
    const last = map.columns[52]
    // Oct 15, 2026 is a Thursday: Sunday to Thursday filled, Friday and Saturday empty.
    expect(last.map((c) => c?.key ?? null)).toEqual([
      "2026-10-11",
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      null,
      null,
    ])
    expect(last[4]).toMatchObject({ level: 2, label: "Thu, Oct 15: 1 session" })
    expect(map.activeDays).toBe(3)
    expect(map.longestStreak).toBe(2)
    expect(map.columns[0][0]?.key).toBe("2025-10-12")
  })

  it("drops a partial first month label that would collide with the next", () => {
    const map = buildHeatmap(new Map(), "2026-10-15")
    // The grid opens on Sun, Oct 12, 2025; Nov 1 falls in the third column.
    expect(map.months[0]).toEqual({ label: "Nov", column: 2 })
    expect(map.months.at(-1)?.label).toBe("Oct")
    for (let i = 1; i < map.months.length; i++) {
      expect(map.months[i].column - map.months[i - 1].column).toBeGreaterThanOrEqual(3)
    }
  })

  it("dates days from another year with the year", () => {
    expect(dayLabel("2025-10-14", "2026-10-15")).toBe("Oct 14, 2025")
    expect(dayLabel("2026-10-14", "2026-10-15")).toBe("Wed, Oct 14")
  })
})

describe("achievements", () => {
  it("measures the perfect-deck achievement in perfect decks, not reviews", () => {
    const views = achievementViews({ streak: 4, xp: 202, reviews: 56, perfectDecks: 0 }, [])
    const perfect = views.find((v) => v.key === "FIRST_PERFECT")
    expect(perfect).toMatchObject({ current: 0, threshold: 1, progressText: "0 of 1 perfect deck" })
    const week = views.find((v) => v.key === "STREAK_7")
    expect(week?.progressText).toBe("4 of 7 days")
    const xp = views.find((v) => v.key === "XP_1000")
    expect(xp?.progressText).toBe("202 of 1,000 XP")
  })

  it("caps progress at the threshold and keeps earned dates", () => {
    const views = achievementViews({ streak: 9, xp: 0, reviews: 0, perfectDecks: 0 }, [
      { badgeType: "STREAK_3", earnedAt: "2026-10-05T20:17:42.000Z" },
    ])
    expect(views.find((v) => v.key === "STREAK_3")).toMatchObject({
      current: 3,
      earnedAt: "2026-10-05T20:17:42.000Z",
    })
  })

  it("awards only what the values reach and skips earned ones", () => {
    expect(badgesReached({ streak: 7, xp: 120, reviews: 1, perfectDecks: 0 }, new Set(["STREAK_3"]))).toEqual([
      "STREAK_7",
      "FIRST_REVIEW",
      "XP_100",
    ])
  })

  it("keeps every stored badge key", () => {
    expect(ALL_BADGES.map((b) => b.key)).toEqual([
      "STREAK_3",
      "STREAK_7",
      "STREAK_14",
      "STREAK_30",
      "STREAK_60",
      "STREAK_100",
      "FIRST_REVIEW",
      "REVIEWS_100",
      "REVIEWS_500",
      "FIRST_PERFECT",
      "XP_100",
      "XP_1000",
    ])
  })
})
