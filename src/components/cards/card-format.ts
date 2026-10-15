import { formatDuration, plural } from "@/lib/format"
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
 * noon UTC, which falls on that same calendar day in every zone from
 * UTC-11 to UTC+11. Plain `new Date("2026-10-22")` is midnight UTC and shows
 * the day before in the Americas.
 */
export function calendarDate(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`)
}

export function cardCount(count: number): string {
  return plural(count, { zero: "No cards", one: "# card", other: "# cards" })
}
