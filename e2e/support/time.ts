/**
 * Calendar days and time zones for test data. The browser runs in TIME_ZONE
 * (America/New_York), and so do plans unless a test picks another zone, so
 * days are counted there rather than in the zone of the machine running the
 * suite (a CI runner in UTC is a day ahead of New York every evening).
 */
import { TIME_ZONE } from "./env";

/** The calendar day `days` from today in `timeZone`, as the API's YYYY-MM-DD. */
export function dayIn(timeZone: string, days: number): string {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The calendar day `days` from today in the suite's time zone. */
export function isoDay(days: number): string {
  return dayIn(TIME_ZONE, days);
}

/**
 * A fixed-offset zone where it is now between 10:00 and 11:00. A plan made in
 * it with an all-day study window always has sessions left today, so the
 * Today card and the Start button don't depend on when the suite runs.
 */
export function morningZone(): string {
  const offset = ((10 - new Date().getUTCHours() + 36) % 24) - 12;
  if (offset === 0) return "Etc/GMT";
  // Etc/GMT names are sign-inverted: Etc/GMT-8 is UTC+8.
  return `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
