/**
 * Sentences shared by the Study screen and the recommendation service.
 * Pure (no React, no database) so both sides import the same wording.
 */
import { plural } from "@/lib/format"

/** The four countdown messages of VOICE.md: "Prelim 1 is in 9 days". */
export function examCountdown(examName: string, daysUntil: number): string {
  if (daysUntil === 0) return `${examName} is today`
  if (daysUntil === 1) return `${examName} is tomorrow`
  if (daysUntil > 1) return `${examName} is in ${plural(daysUntil, { one: "# day", other: "# days" })}`
  return `${examName} was ${plural(-daysUntil, { one: "# day", other: "# days" })} ago`
}

/**
 * The "Planned for today" line for a course with a plan but nothing left
 * to start today. It tells a day with nothing planned from a day whose
 * sessions are finished, as Home's Today card does.
 *
 * @param today Sessions on today's date (any status) and how many are done.
 * @param next The next planned session, already worded ("Retrieval, Wed, Oct 21 at 11:00 AM"), if any.
 */
export function nothingLeftTodayLine(
  courseName: string,
  today: { planned: number; done: number },
  next: string | null,
): string {
  // The course name stays outside plural(), which reads "#" as the count.
  const doneLine =
    today.planned > 0 && today.done === today.planned
      ? `Today's ${courseName} ${plural(today.planned, { one: "session is done", other: "sessions are done" })}`
      : null
  if (next) {
    if (doneLine) return `${doneLine}. Next: ${next}.`
    if (today.planned === 0) return `No ${courseName} sessions today. Next: ${next}.`
    return `No ${courseName} sessions left today. Next: ${next}.`
  }
  if (doneLine) return `${doneLine}, and nothing else is scheduled.`
  return `No more sessions planned for ${courseName}.`
}
