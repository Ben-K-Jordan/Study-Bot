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
