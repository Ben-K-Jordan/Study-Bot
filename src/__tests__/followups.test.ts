import { describe, it, expect } from "vitest";
import { computeFollowupSchedule } from "@/services/followups";

/**
 * Unit tests for the pure follow-up scheduling core: deterministic mapping
 * from a completed run's results onto concrete plan dates, timezone-aware,
 * exam-capped. (DB insertion + idempotency are covered by the integration
 * suite in src/__tests__/integration/followups.test.ts.)
 */

const AVAILABILITY = Array.from({ length: 7 }, () => ({
  start: "09:00",
  end: "17:00",
}));

// 2026-07-16 15:00:00 UTC = 11:00 in America/New_York (EDT)
const ENDED_AT = new Date("2026-07-16T15:00:00Z");

function baseInput(overrides: Partial<Parameters<typeof computeFollowupSchedule>[0]> = {}) {
  return {
    accuracy: 0.75,
    endedAt: ENDED_AT,
    timezone: "America/New_York",
    examDate: "2026-08-15",
    planStartDate: "2026-07-16",
    availability: AVAILABILITY,
    ...overrides,
  };
}

describe("computeFollowupSchedule", () => {
  it("is a deterministic function of the run's results", () => {
    const a = computeFollowupSchedule(baseInput());
    const b = computeFollowupSchedule(baseInput());
    expect(a).toEqual(b);
  });

  it("uses the spaced-repetition ladder offsets (accuracy 0.75 -> 2 and 4 days)", () => {
    const { planned, skipped } = computeFollowupSchedule(baseInput());
    expect(skipped).toEqual([]);
    expect(planned.map((p) => p.days_from_now)).toEqual([2, 4]);
    expect(planned.map((p) => p.date)).toEqual(["2026-07-18", "2026-07-20"]);
  });

  it("uses shorter intervals for low accuracy and longer for high accuracy", () => {
    const low = computeFollowupSchedule(baseInput({ accuracy: 0.5 }));
    const high = computeFollowupSchedule(baseInput({ accuracy: 0.9 }));
    expect(low.planned.map((p) => p.days_from_now)).toEqual([1, 2]);
    expect(high.planned.map((p) => p.days_from_now)).toEqual([3, 6]);
  });

  it("computes calendar dates in the plan's timezone, not the server's", () => {
    // 03:00 UTC on the 16th is still 23:00 on the 15th in New York, so
    // "+2 days" lands on the 17th there.
    const { planned } = computeFollowupSchedule(
      baseInput({ endedAt: new Date("2026-07-16T03:00:00Z") }),
    );
    expect(planned.map((p) => p.date)).toEqual(["2026-07-17", "2026-07-19"]);
  });

  it("schedules at the availability window start in the plan's timezone", () => {
    const { planned } = computeFollowupSchedule(baseInput());
    // 09:00 America/New_York (EDT, UTC-4) = 13:00 UTC
    expect(planned[0].start_time.toISOString()).toBe("2026-07-18T13:00:00.000Z");
    expect(planned[0].day_index).toBe(2);
  });

  it("gives every follow-up a ~30 minute duration", () => {
    const { planned } = computeFollowupSchedule(baseInput());
    for (const p of planned) {
      expect(p.end_time.getTime() - p.start_time.getTime()).toBe(30 * 60000);
    }
  });

  it("skips dates past the exam", () => {
    const { planned, skipped } = computeFollowupSchedule(
      baseInput({ examDate: "2026-07-18" }),
    );
    expect(planned.map((p) => p.days_from_now)).toEqual([2]);
    expect(skipped).toEqual([
      { date: "2026-07-20", days_from_now: 4, reason: "past_exam" },
    ]);
  });

  it("skips everything when the exam is tomorrow and accuracy is high", () => {
    const { planned, skipped } = computeFollowupSchedule(
      baseInput({ accuracy: 0.95, examDate: "2026-07-17" }),
    );
    expect(planned).toEqual([]);
    expect(skipped).toHaveLength(2);
    expect(skipped.every((s) => s.reason === "past_exam")).toBe(true);
  });

  it("allows a follow-up on the exam day itself", () => {
    const { planned } = computeFollowupSchedule(baseInput({ examDate: "2026-07-18" }));
    expect(planned.some((p) => p.date === "2026-07-18")).toBe(true);
  });

  it("wraps availability by weekday for days beyond the plan window", () => {
    const availability = AVAILABILITY.map((a, i) =>
      i === 1 ? { start: "14:30", end: "18:00" } : a,
    );
    // Plan started 7-16; run ends 7-20 (day 4); +4 days = day 8 -> wraps to
    // availability[1] (14:30).
    const { planned } = computeFollowupSchedule(
      baseInput({
        endedAt: new Date("2026-07-20T15:00:00Z"),
        availability,
      }),
    );
    const late = planned.find((p) => p.days_from_now === 4)!;
    expect(late.day_index).toBe(8);
    // 14:30 America/New_York (EDT) = 18:30 UTC
    expect(late.start_time.toISOString()).toBe("2026-07-24T18:30:00.000Z");
  });

  it("falls back to 09:00 when no availability windows exist", () => {
    const { planned } = computeFollowupSchedule(baseInput({ availability: null }));
    expect(planned[0].start_time.toISOString()).toBe("2026-07-18T13:00:00.000Z");
  });

  it("handles DST transitions (spring forward) without drifting", () => {
    // 2026-03-06 ends; +2 days = 2026-03-08, the US spring-forward day.
    const { planned } = computeFollowupSchedule(
      baseInput({
        endedAt: new Date("2026-03-06T15:00:00Z"),
        planStartDate: "2026-03-06",
        examDate: "2026-04-01",
      }),
    );
    // 09:00 America/New_York on 3/8 is EDT (UTC-4) = 13:00 UTC
    expect(planned[0].date).toBe("2026-03-08");
    expect(planned[0].start_time.toISOString()).toBe("2026-03-08T13:00:00.000Z");
  });

  it("falls back to server-local wall time for an invalid timezone", () => {
    const { planned } = computeFollowupSchedule(baseInput({ timezone: "Not/AZone" }));
    expect(planned).toHaveLength(2);
    const d = planned[0].start_time;
    expect(d.getHours()).toBe(9);
    expect(d.getMinutes()).toBe(0);
  });
});
