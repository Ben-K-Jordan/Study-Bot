import { describe, it, expect } from "vitest";
import { computeFollowups } from "@/lib/spacing";

describe("computeFollowups", () => {
  const baseDate = new Date("2026-03-28T10:00:00Z");

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
});
