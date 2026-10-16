import { calendarDay, formatCountdown, formatDateWeekday, formatDuration, plural } from "@/lib/format"
import type { CardStatus } from "@/services/spaced-repetition"

/** Limits for a card's sides (the API enforces the same: services/flashcards.ts). */
export const CARD_FRONT_MAX = 1000
export const CARD_BACK_MAX = 4000

/** Minutes before a card rated Again comes back (services/spaced-repetition.ts). */
const LEARNING_STEP_MINUTES = 10

export const STATUS_LABELS: Record<CardStatus, string> = {
  new: "New",
  learning: "Learning",
  review: "Reviewing",
  mastered: "Mastered",
}

/** "10 min" for the learning step, else "1 day", "6 days". */
export function intervalLabel(days: number): string {
  if (days <= 0) return formatDuration(LEARNING_STEP_MINUTES)
  return plural(days, { one: "# day", other: "# days" })
}

/**
 * An exam date stored as a calendar date ("2026-10-22") as an instant at
 * noon UTC. Read it back only in UTC (examDateLabel, examCountdown): in a
 * zone east of UTC+12 that instant is already the next day, and plain
 * `new Date("2026-10-22")` (midnight UTC) is the day before in the Americas.
 */
export function calendarDate(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`)
}

/** "Thu, Oct 22" for an exam's calendar date, the same in every time zone. */
export function examDateLabel(date: string): string {
  return formatDateWeekday(calendarDate(date), { timeZone: "UTC" })
}

/**
 * "Prelim 1 is in 7 days": whole days from today on the student's clock to
 * the exam's calendar date. Both sides are compared as calendar dates, so
 * the count is right in every zone, UTC+13 and UTC+14 included.
 */
export function examCountdown(
  examName: string,
  date: string,
  { timeZone, now = new Date() }: { timeZone?: string; now?: Date } = {}
): string {
  const today = calendarDay(now, timeZone)
  const todayAsDate = new Date(Date.UTC(today.year, today.month - 1, today.day, 12))
  return formatCountdown(examName, calendarDate(date), { timeZone: "UTC", now: todayAsDate })
}

export function cardCount(count: number): string {
  return plural(count, { zero: "No cards", one: "# card", other: "# cards" })
}
