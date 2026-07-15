/**
 * Simple spacing recommendations based on session accuracy.
 */

interface FollowupRecommendation {
  label: string;
  days_from_now: number;
  date: string; // YYYY-MM-DD in the server's local timezone
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
