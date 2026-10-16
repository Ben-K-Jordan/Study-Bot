/**
 * Pure models behind the Progress screen: confidence calibration, the
 * activity heatmap and achievement progress. Unit-tested in
 * src/__tests__/progress-model.test.ts.
 */
import {
  ALL_BADGES,
  BADGE_CATEGORIES,
  badgeProgress,
  type BadgeCategory,
  type BadgeProgressValues,
} from "@/lib/badge-data"
import { formatDateFull, formatDateShort, formatDateWeekday, formatList, formatNumber, plural } from "@/lib/format"
import { addDays, dayKey } from "@/lib/timezone"
import type { DayActivity } from "@/services/gamification"

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

export type ConfidenceLevel = "sure" | "unsure" | "guessing"

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  sure: "Sure",
  unsure: "Unsure",
  guessing: "Guessing",
}

const LEVEL_ORDER: readonly ConfidenceLevel[] = ["sure", "unsure", "guessing"]

/** Ratings are stored 1, 3, 5; older answers used every step from 1 to 5. */
export function confidenceLevel(rating: number): ConfidenceLevel {
  if (rating >= 4) return "sure"
  if (rating <= 2) return "guessing"
  return "unsure"
}

export interface RatedAnswerLike {
  confidence: number
  /** Scored Correct. Partly correct counts as not right, as on the end screen. */
  correct: boolean
  createdAt: Date
}

/** A scored answer as stored: confidence 1 to 5 or null, self-score CORRECT, PARTIAL or INCORRECT. */
export interface ScoredAttemptLike {
  runId: string
  promptIndex: number
  confidenceRating: number | null
  selfScore: string | null
  createdAt: Date
}

/** Key for one question of one run, as `pretestKey(runId, promptIndex)`. */
export function pretestKey(runId: string, promptIndex: number): string {
  return `${runId}:${promptIndex}`
}

/**
 * Split scored answers into rated ones and a count of unrated ones. Pretest
 * answers are left out entirely: wrong answers are expected there and don't
 * count toward accuracy, so the end screen leaves them out of confidence too.
 */
export function splitRatedAnswers(
  attempts: readonly ScoredAttemptLike[],
  pretests: ReadonlySet<string>
): { rated: RatedAnswerLike[]; unrated: number } {
  const rated: RatedAnswerLike[] = []
  let unrated = 0
  for (const a of attempts) {
    if (a.selfScore == null || pretests.has(pretestKey(a.runId, a.promptIndex))) continue
    if (a.confidenceRating == null) {
      unrated += 1
      continue
    }
    rated.push({ confidence: a.confidenceRating, correct: a.selfScore === "CORRECT", createdAt: a.createdAt })
  }
  return { rated, unrated }
}

export interface LevelSummary {
  level: ConfidenceLevel
  answers: number
  correct: number
  /** Share answered correctly, or null with no answers. */
  rate: number | null
}

export interface WeekPoint {
  /** First day of the week (Sunday), YYYY-MM-DD in the student's zone. */
  weekKey: string
  /** "Oct 4" */
  label: string
  sure: number | null
  unsure: number | null
  guessing: number | null
  answers: number
}

export interface Calibration {
  levels: LevelSummary[]
  rated: number
  /** Marked Sure and not fully correct (partly correct included), as on the end screen. */
  overconfident: number
  /** Marked Guessing and answered correctly. */
  underconfident: number
  /** Each level with 3+ answers is right more often than the level below it. */
  ordered: boolean
  weeks: WeekPoint[]
}

/** The Sunday that starts the week holding `key`. */
export function weekStart(key: string): string {
  const weekday = new Date(`${key}T12:00:00Z`).getUTCDay()
  return addDays(key, -weekday)
}

/** "Oct 4" for a YYYY-MM-DD key, read as a calendar date. */
export function keyLabel(key: string): string {
  return formatDateShort(`${key}T12:00:00Z`, { timeZone: "UTC" })
}

/** "Wed, Oct 14" this year, "Oct 14, 2025" in another year. */
export function dayLabel(key: string, todayKey: string): string {
  const date = `${key}T12:00:00Z`
  return key.slice(0, 4) === todayKey.slice(0, 4)
    ? formatDateWeekday(date, { timeZone: "UTC" })
    : formatDateFull(date, { timeZone: "UTC" })
}

function summarize(answers: readonly RatedAnswerLike[], level: ConfidenceLevel): LevelSummary {
  const mine = answers.filter((a) => confidenceLevel(a.confidence) === level)
  const correct = mine.filter((a) => a.correct).length
  return { level, answers: mine.length, correct, rate: mine.length > 0 ? correct / mine.length : null }
}

export function calibrate(
  answers: readonly RatedAnswerLike[],
  timeZone: string,
  maxWeeks = 8
): Calibration {
  const levels = LEVEL_ORDER.map((level) => summarize(answers, level))
  const overconfident = answers.filter((a) => confidenceLevel(a.confidence) === "sure" && !a.correct).length
  const underconfident = answers.filter(
    (a) => confidenceLevel(a.confidence) === "guessing" && a.correct
  ).length

  const solid = levels.filter((l) => l.answers >= 3 && l.rate !== null)
  const ordered =
    solid.length >= 2 && solid.every((l, i) => i === 0 || (solid[i - 1].rate ?? 0) > (l.rate ?? 0))

  const byWeek = new Map<string, RatedAnswerLike[]>()
  for (const a of answers) {
    const key = weekStart(dayKey(a.createdAt, timeZone))
    const list = byWeek.get(key)
    if (list) list.push(a)
    else byWeek.set(key, [a])
  }
  const weeks = [...byWeek.keys()]
    .sort()
    .slice(-maxWeeks)
    .map((weekKey) => {
      const list = byWeek.get(weekKey) ?? []
      const rate = (level: ConfidenceLevel) => summarize(list, level).rate
      return {
        weekKey,
        label: keyLabel(weekKey),
        sure: rate("sure"),
        unsure: rate("unsure"),
        guessing: rate("guessing"),
        answers: list.length,
      }
    })

  return { levels, rated: answers.length, overconfident, underconfident, ordered, weeks }
}

// ---------------------------------------------------------------------------
// Activity heatmap
// ---------------------------------------------------------------------------

export type HeatLevel = 0 | 1 | 2 | 3 | 4

/** Stronger squares mean more XP that day: 1+, 10+, 25+, 50+. */
export function heatLevel(xp: number): HeatLevel {
  if (xp >= 50) return 4
  if (xp >= 25) return 3
  if (xp >= 10) return 2
  if (xp >= 1) return 1
  return 0
}

/** What a day held, in words: "1 session and 8 card reviews". */
export function describeDay(day: DayActivity | undefined): string {
  if (!day) return "No study"
  const parts: string[] = []
  if (day.sessions > 0) parts.push(plural(day.sessions, { one: "# session", other: "# sessions" }))
  if (day.reviews > 0) parts.push(plural(day.reviews, { one: "# card review", other: "# card reviews" }))
  // XP from actions that no longer earn any (older guide and chat events).
  if (parts.length === 0 && day.xp > 0) parts.push(`${formatNumber(day.xp)} XP`)
  if (parts.length > 0) {
    const text = formatList(parts)
    return day.freezeUsed ? `${text}, and a streak freeze` : text
  }
  return day.freezeUsed ? "Streak freeze used" : "No study"
}

/** Whether a day holds any study (a freeze alone doesn't count). */
export function isStudyDay(day: DayActivity | undefined): boolean {
  return !!day && day.xp + day.sessions + day.reviews > 0
}

export interface HeatCell {
  key: string
  level: HeatLevel
  freeze: boolean
  /** "Wed, Oct 14: 1 session and 8 card reviews" */
  label: string
}

export interface Heatmap {
  /** Week columns, Sunday first; null pads the days after today. */
  columns: (HeatCell | null)[][]
  months: { label: string; column: number }[]
  activeDays: number
  longestStreak: number
}

export function buildHeatmap(
  days: ReadonlyMap<string, DayActivity>,
  todayKey: string,
  weeks = 53
): Heatmap {
  const start = addDays(weekStart(todayKey), -(weeks - 1) * 7)
  const columns: (HeatCell | null)[][] = []
  const months: { label: string; column: number }[] = []
  let lastMonth = ""
  let activeDays = 0
  let run = 0
  let longestStreak = 0

  for (let c = 0; c < weeks; c++) {
    const column: (HeatCell | null)[] = []
    for (let r = 0; r < 7; r++) {
      const key = addDays(start, c * 7 + r)
      if (key > todayKey) {
        column.push(null)
        continue
      }
      const month = key.slice(0, 7)
      if (month !== lastMonth) {
        lastMonth = month
        // A label needs about 3 columns of room. The first month is usually
        // partial, so it gives way to the next; later ones never collide.
        const label = { label: keyLabel(`${month}-01`).split(" ")[0], column: c }
        const previous = months[months.length - 1]
        if (!previous || c - previous.column >= 3) months.push(label)
        else if (months.length === 1) months[0] = label
      }
      const day = days.get(key)
      const studied = isStudyDay(day)
      if (studied) activeDays += 1
      run = studied || day?.freezeUsed ? run + 1 : 0
      longestStreak = Math.max(longestStreak, run)
      column.push({
        key,
        level: day ? heatLevel(day.xp) : 0,
        freeze: !!day?.freezeUsed,
        label: `${dayLabel(key, todayKey)}: ${describeDay(day)}`,
      })
    }
    columns.push(column)
  }
  return { columns, months, activeDays, longestStreak }
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface AchievementView {
  key: string
  label: string
  description: string
  category: BadgeCategory
  earnedAt: string | null
  current: number
  threshold: number
  /** "2 of 7 days" */
  progressText: string
}

export function achievementViews(
  values: BadgeProgressValues,
  earned: readonly { badgeType: string; earnedAt: string }[]
): AchievementView[] {
  const earnedAt = new Map(earned.map((a) => [a.badgeType, a.earnedAt]))
  return ALL_BADGES.map((badge) => {
    const current = Math.min(badgeProgress(badge, values), badge.threshold)
    return {
      key: badge.key,
      label: badge.label,
      description: badge.description,
      category: badge.category,
      earnedAt: earnedAt.get(badge.key) ?? null,
      current,
      threshold: badge.threshold,
      progressText: `${formatNumber(current)} of ${plural(badge.threshold, badge.unit)}`,
    }
  })
}

export function achievementGroups(views: readonly AchievementView[]) {
  return BADGE_CATEGORIES.map((category) => ({
    ...category,
    items: views.filter((v) => v.category === category.key),
  }))
}
