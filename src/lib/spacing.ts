/**
 * Shared spacing utilities: session follow-up recommendations and exam-aware
 * interval compression (Cepeda et al. 2008 — the optimal review gap scales
 * with the retention interval, i.e. the time remaining until the exam).
 */

export interface FollowupRecommendation {
  label: string;
  days_from_now: number;
  date: string; // YYYY-MM-DD in the server's local timezone
}

/**
 * Exam-aware interval compression (Cepeda et al. 2008).
 *
 * Caps a proposed spacing interval so all reviews complete before the exam;
 * closer exams compress intervals more aggressively. When no exam date is
 * provided, the interval is returned unchanged. Extracted verbatim from the
 * ObjectiveMastery SM-2 engine so every scheduler shares one policy.
 */
export function compressIntervalForExam(
  intervalDays: number,
  examDate: Date | null | undefined,
  now: Date = new Date(),
): number {
  if (!examDate) return intervalDays;

  const daysUntilExam = Math.max(
    1,
    Math.floor((examDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
  );

  if (daysUntilExam <= 3) {
    // Exam in 1-3 days: review everything daily
    return 1;
  }
  if (daysUntilExam <= 7) {
    // Exam in 4-7 days: cap at 2 days
    return Math.min(intervalDays, 2);
  }
  if (daysUntilExam <= 14) {
    // Exam in 1-2 weeks: cap at 3 days
    return Math.min(intervalDays, 3);
  }
  // More than 2 weeks: cap so next review is before exam.
  // Use ~20% of remaining time as max interval (Cepeda optimal gap ratio).
  const maxInterval = Math.max(1, Math.floor(daysUntilExam * 0.2));
  return Math.min(intervalDays, maxInterval);
}

/**
 * Format a date as YYYY-MM-DD using local date components (not UTC), so the
 * date matches the "in N days" label for users behind UTC studying at night.
 */
function formatLocalDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function computeFollowups(accuracy: number, now: Date = new Date()): FollowupRecommendation[] {
  let dayOffsets: number[];

  if (accuracy < 0.7) {
    dayOffsets = [1, 2];
  } else if (accuracy <= 0.85) {
    dayOffsets = [2, 4];
  } else {
    dayOffsets = [3, 6];
  }

  return dayOffsets.map((days) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return {
      label: `Retrieval session in ${days} day${days === 1 ? "" : "s"}`,
      days_from_now: days,
      date: formatLocalDate(d),
    };
  });
}

/**
 * Difference in local calendar days between two instants (positive when `to`
 * is on a later local calendar day than `from`).
 */
function localDayDiff(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/**
 * Convert mastery due dates (e.g. ObjectiveMastery.nextDueAt) into follow-up
 * recommendations, so session follow-ups reflect the SM-2 schedule instead of
 * fixed offsets. Takes the soonest 1-3 distinct local calendar days; due
 * dates in the past or today are clamped to tomorrow. Returns [] when there
 * are no due dates — callers should fall back to computeFollowups.
 */
export function followupsFromDueDates(
  dueDates: Date[],
  now: Date = new Date(),
): FollowupRecommendation[] {
  const dayOffsets = Array.from(
    new Set(dueDates.map((due) => Math.max(1, localDayDiff(now, due)))),
  )
    .sort((a, b) => a - b)
    .slice(0, 3);

  return dayOffsets.map((days) => {
    const d = new Date(now);
    d.setDate(d.getDate() + days);
    return {
      label: `Review session in ${days} day${days === 1 ? "" : "s"}`,
      days_from_now: days,
      date: formatLocalDate(d),
    };
  });
}
