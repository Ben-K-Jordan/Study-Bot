import { describe, it, expect } from "vitest";
import { computeFollowups, compressIntervalForExam, followupsFromDueDates } from "@/lib/spacing";

describe("computeFollowups", () => {
  // Local-time constructor: dates are formatted from local components, so
  // assertions must be timezone-independent.
  const baseDate = new Date(2026, 2, 28, 10, 0, 0);

  it("recommends day+1 and day+2 for accuracy < 70%", () => {
    const result = computeFollowups(0.5, baseDate);
    expect(result).toHaveLength(2);
    expect(result[0].days_from_now).toBe(1);
    expect(result[1].days_from_now).toBe(2);
    expect(result[0].date).toBe("2026-03-29");
    expect(result[1].date).toBe("2026-03-30");
  });

  it("recommends day+2 and day+4 for accuracy 70-85%", () => {
    const result = computeFollowups(0.75, baseDate);
    expect(result[0].days_from_now).toBe(2);
    expect(result[1].days_from_now).toBe(4);
  });

  it("recommends day+3 and day+6 for accuracy > 85%", () => {
    const result = computeFollowups(0.9, baseDate);
    expect(result[0].days_from_now).toBe(3);
    expect(result[1].days_from_now).toBe(6);
  });

  it("treats 85% as mid-range", () => {
    const result = computeFollowups(0.85, baseDate);
    expect(result[0].days_from_now).toBe(2);
  });

  it("includes descriptive labels", () => {
    const result = computeFollowups(0.5, baseDate);
    expect(result[0].label).toContain("1 day");
    expect(result[1].label).toContain("2 days");
  });

  it("uses the local calendar date, not the UTC date", () => {
    // Regression: for a user behind UTC studying in the evening, the UTC
    // calendar date is already tomorrow, so UTC formatting made the date one
    // day later than the "in N days" label implies.
    const originalTZ = process.env.TZ;
    process.env.TZ = "America/New_York"; // UTC-4 on this date
    try {
      // 10pm local on March 28 is 2am UTC on March 29
      const evening = new Date(2026, 2, 28, 22, 0, 0);
      const result = computeFollowups(0.5, evening);
      expect(result[0].date).toBe("2026-03-29");
      expect(result[1].date).toBe("2026-03-30");
    } finally {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  });
});

describe("compressIntervalForExam", () => {
  // Expected values below are computed from the original inline logic in
  // mastery.ts's sm2Next, which this function was extracted from — they prove
  // the extraction is behavior-identical.
  const now = new Date("2025-01-15T12:00:00Z");
  const daysFromNow = (d: number) => new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  it("returns the interval unchanged when there is no exam date", () => {
    expect(compressIntervalForExam(15, null, now)).toBe(15);
    expect(compressIntervalForExam(15, undefined, now)).toBe(15);
    expect(compressIntervalForExam(1, null, now)).toBe(1);
  });

  it("forces daily review when the exam is 1-3 days away", () => {
    expect(compressIntervalForExam(15, daysFromNow(1), now)).toBe(1);
    expect(compressIntervalForExam(15, daysFromNow(2), now)).toBe(1);
    expect(compressIntervalForExam(15, daysFromNow(3), now)).toBe(1);
    expect(compressIntervalForExam(1, daysFromNow(2), now)).toBe(1);
  });

  it("caps at 2 days when the exam is 4-7 days away", () => {
    expect(compressIntervalForExam(15, daysFromNow(4), now)).toBe(2);
    expect(compressIntervalForExam(15, daysFromNow(7), now)).toBe(2);
    // Never lengthens a shorter interval
    expect(compressIntervalForExam(1, daysFromNow(5), now)).toBe(1);
  });

  it("caps at 3 days when the exam is 8-14 days away", () => {
    expect(compressIntervalForExam(15, daysFromNow(8), now)).toBe(3);
    expect(compressIntervalForExam(15, daysFromNow(14), now)).toBe(3);
    expect(compressIntervalForExam(2, daysFromNow(10), now)).toBe(2);
  });

  it("caps at ~20% of remaining days when the exam is beyond 2 weeks", () => {
    expect(compressIntervalForExam(15, daysFromNow(15), now)).toBe(3); // floor(15*0.2)
    expect(compressIntervalForExam(15, daysFromNow(30), now)).toBe(6); // floor(30*0.2)
    expect(compressIntervalForExam(15, daysFromNow(45), now)).toBe(9); // floor(45*0.2)
    // Cap (24) exceeds the interval — leave it alone
    expect(compressIntervalForExam(15, daysFromNow(120), now)).toBe(15);
  });

  it("floors partial days until the exam", () => {
    // 3.5 days floors to 3 → daily-review branch
    expect(compressIntervalForExam(15, daysFromNow(3.5), now)).toBe(1);
    // 7.9 days floors to 7 → 2-day cap
    expect(compressIntervalForExam(15, daysFromNow(7.9), now)).toBe(2);
  });

  it("treats same-day or past exam dates as 1 day away", () => {
    expect(compressIntervalForExam(15, daysFromNow(0), now)).toBe(1);
    expect(compressIntervalForExam(15, daysFromNow(-5), now)).toBe(1);
  });
});

describe("followupsFromDueDates", () => {
  // Local-time constructor, same convention as the computeFollowups tests.
  const baseDate = new Date(2026, 2, 28, 10, 0, 0);
  const dueIn = (days: number, hour = 10) => new Date(2026, 2, 28 + days, hour, 0, 0);

  it("converts a due date into the followup shape with a local date", () => {
    const result = followupsFromDueDates([dueIn(2)], baseDate);
    expect(result).toEqual([
      { label: "Review session in 2 days", days_from_now: 2, date: "2026-03-30" },
    ]);
  });

  it("uses a singular label for 1 day", () => {
    const result = followupsFromDueDates([dueIn(1)], baseDate);
    expect(result[0].label).toBe("Review session in 1 day");
    expect(result[0].date).toBe("2026-03-29");
  });

  it("sorts by soonest due date first", () => {
    const result = followupsFromDueDates([dueIn(6), dueIn(1), dueIn(3)], baseDate);
    expect(result.map((r) => r.days_from_now)).toEqual([1, 3, 6]);
    expect(result.map((r) => r.date)).toEqual(["2026-03-29", "2026-03-31", "2026-04-03"]);
  });

  it("dedupes due dates that fall on the same local calendar day", () => {
    const result = followupsFromDueDates([dueIn(2, 8), dueIn(2, 22), dueIn(4)], baseDate);
    expect(result.map((r) => r.days_from_now)).toEqual([2, 4]);
  });

  it("returns at most 3 followups", () => {
    const result = followupsFromDueDates([1, 2, 3, 4, 5].map((d) => dueIn(d)), baseDate);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.days_from_now)).toEqual([1, 2, 3]);
  });

  it("returns an empty array when there are no due dates", () => {
    expect(followupsFromDueDates([], baseDate)).toEqual([]);
  });

  it("clamps overdue and same-day due dates to tomorrow, deduped", () => {
    const result = followupsFromDueDates([dueIn(0), dueIn(-3)], baseDate);
    expect(result).toEqual([
      { label: "Review session in 1 day", days_from_now: 1, date: "2026-03-29" },
    ]);
  });

  it("counts local calendar days across a late-night boundary", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "America/New_York"; // UTC-4 on this date
    try {
      // 10pm local March 28 (already March 29 in UTC); due 4am local March 30
      const evening = new Date(2026, 2, 28, 22, 0, 0);
      const due = new Date(2026, 2, 30, 4, 0, 0);
      const result = followupsFromDueDates([due], evening);
      expect(result).toEqual([
        { label: "Review session in 2 days", days_from_now: 2, date: "2026-03-30" },
      ]);
    } finally {
      if (originalTZ === undefined) delete process.env.TZ;
      else process.env.TZ = originalTZ;
    }
  });
});
