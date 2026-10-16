import { describe, it, expect } from "vitest";
import { activePlan, computeFollowupSchedule } from "@/services/followups";

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

/** The results are read the moment the run ends, unless a test says when. */
function baseInput(overrides: Partial<Parameters<typeof computeFollowupSchedule>[0]> = {}) {
  return {
    accuracy: 0.75,
    endedAt: ENDED_AT,
    timezone: "America/New_York",
    examDate: "2026-08-15",
    planStartDate: "2026-07-16",
    availability: AVAILABILITY,
    now: overrides.endedAt ?? ENDED_AT,
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

  describe("when the results are opened later", () => {
    // Accuracy 0.6: follow-ups 1 and 2 days after the run, Jul 17 and Jul 18
    const late = (now: string, overrides: Partial<Parameters<typeof computeFollowupSchedule>[0]> = {}) =>
      computeFollowupSchedule(baseInput({ accuracy: 0.6, now: new Date(now), ...overrides }));

    it("skips days that are over instead of adding sessions that are already missed", () => {
      // Two days after the run: Jul 18, 8:00 AM in New York
      const { planned, skipped } = late("2026-07-18T12:00:00Z");
      expect(skipped).toEqual([{ date: "2026-07-17", days_from_now: 1, reason: "past" }]);
      expect(planned.map((p) => p.date)).toEqual(["2026-07-18"]);
      // Today's window hasn't opened yet, so the session keeps its 9:00 AM start
      expect(planned[0].start_time.toISOString()).toBe("2026-07-18T13:00:00.000Z");
    });

    it("adds nothing once every day has passed", () => {
      const { planned, skipped } = late("2026-07-20T12:00:00Z");
      expect(planned).toEqual([]);
      expect(skipped.map((s) => [s.date, s.reason])).toEqual([
        ["2026-07-17", "past"],
        ["2026-07-18", "past"],
      ]);
    });

    it("starts a follow-up today at the next quarter hour once the window is under way", () => {
      // Jul 18, 2:07 PM in New York
      const { planned } = late("2026-07-18T18:07:33Z");
      expect(planned.map((p) => p.date)).toEqual(["2026-07-18"]);
      expect(planned[0].start_time.toISOString()).toBe("2026-07-18T18:15:00.000Z");
      expect(planned[0].end_time.toISOString()).toBe("2026-07-18T18:45:00.000Z");
    });

    it("skips today when the session no longer fits before the window closes", () => {
      // Jul 18, 4:40 PM in New York: 4:45 to 5:15 runs past the 5:00 PM close
      const { planned, skipped } = late("2026-07-18T20:40:00Z");
      expect(planned).toEqual([]);
      expect(skipped.map((s) => [s.date, s.reason])).toEqual([
        ["2026-07-17", "past"],
        ["2026-07-18", "past"],
      ]);
    });

    it("still reports a day after the exam as past_exam", () => {
      const { skipped } = late("2026-07-18T12:00:00Z", { examDate: "2026-07-17" });
      expect(skipped.map((s) => [s.date, s.reason])).toEqual([
        ["2026-07-17", "past"],
        ["2026-07-18", "past_exam"],
      ]);
    });
  });

  it("falls back to UTC wall time for an invalid timezone", () => {
    const { planned } = computeFollowupSchedule(baseInput({ timezone: "Not/AZone" }));
    expect(planned).toHaveLength(2);
    const d = planned[0].start_time;
    expect(d.getUTCHours()).toBe(9);
    expect(d.getUTCMinutes()).toBe(0);
  });
});

describe("activePlan", () => {
  const plan = (id: string, examDate: string, timezone = "America/New_York") => ({
    id,
    examDate: new Date(`${examDate}T00:00:00.000Z`),
    timezone,
  });
  // Thu 2026-10-15, 4:00 PM in New York (already Oct 15 evening in UTC)
  const now = new Date("2026-10-15T20:00:00Z");

  it("keeps an exam that is today on the plan's calendar", () => {
    expect(activePlan([plan("today", "2026-10-15"), plan("later", "2026-10-22")], now)?.id).toBe("today");
  });

  it("skips exams that are over in the plan's zone", () => {
    expect(activePlan([plan("yesterday", "2026-10-14"), plan("later", "2026-10-22")], now)?.id).toBe("later");
    // 11 PM in New York is already the 16th in Tokyo
    const late = new Date("2026-10-16T03:00:00Z");
    expect(activePlan([plan("tokyo", "2026-10-15", "Asia/Tokyo")], late)).toBeUndefined();
    expect(activePlan([plan("ny", "2026-10-15")], late)?.id).toBe("ny");
  });
});
