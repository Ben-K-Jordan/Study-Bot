/**
 * Simple spacing recommendations based on session accuracy.
 */

export interface FollowupRecommendation {
  label: string;
  days_from_now: number;
  date: string; // ISO date string
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
      date: d.toISOString().split("T")[0],
    };
  });
}
