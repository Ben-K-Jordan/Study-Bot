import { describe, it, expect } from "vitest";
import { computeFollowups } from "@/lib/spacing";

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
