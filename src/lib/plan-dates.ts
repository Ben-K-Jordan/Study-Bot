/**
 * Calendar days stored in Postgres DATE columns (StudyPlan.examDate,
 * startDate, endDate).
 *
 * Prisma reads a DATE as midnight UTC of that day, so the day is the UTC
 * date of the value. Reading it through dayKey(date, "America/New_York")
 * would land on the evening before and report the plan one day early.
 * Writing a full timestamp has the mirror problem: Postgres keeps the UTC
 * date of the instant, which in the evening is already tomorrow. Always
 * write and read these columns through the two helpers below.
 */

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day (YYYY-MM-DD) a DATE column holds. */
export function dateColumnKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The value to write a calendar day (YYYY-MM-DD) into a DATE column. */
export function dateColumnValue(key: string): Date {
  if (!DAY_KEY.test(key)) throw new Error(`Not a calendar day: ${key}`);
  return new Date(`${key}T00:00:00.000Z`);
}
