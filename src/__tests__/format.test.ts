import { describe, expect, it } from "vitest";
import {
  calendarDay,
  daysUntil,
  formatCountdown,
  formatDate,
  formatDateFull,
  formatDateShort,
  formatDateTime,
  formatDateWeekday,
  formatDayHeading,
  formatDuration,
  formatList,
  formatNumber,
  formatPercent,
  formatRelativeDay,
  formatTime,
  formatTimeRange,
  plural,
} from "@/lib/format";

const NY = { timeZone: "America/New_York" };
// Wednesday, Oct 14 2026, 2:00 PM in New York (18:00 UTC)
const WED_2PM = new Date("2026-10-14T18:00:00Z");

describe("times", () => {
  it("formats a time without a leading zero", () => {
    expect(formatTime(WED_2PM, NY)).toMatch(/^2:00\sPM$/);
    expect(formatTime(new Date("2026-10-14T13:05:00Z"), NY)).toMatch(/^9:05\sAM$/);
  });

  it("formats a range with one meridiem", () => {
    const end = new Date("2026-10-14T18:30:00Z");
    expect(formatTimeRange(WED_2PM, end, NY)).toMatch(/^2:00\s*\u2013\s*2:30\sPM$/);
  });

  it("writes the same spaces on every runtime", () => {
    const end = new Date("2026-10-14T18:30:00Z");
    expect(formatTimeRange(WED_2PM, end, NY)).toBe("2:00\u2009\u2013\u20092:30\u00a0PM");
    expect(formatTime(WED_2PM, NY)).toBe("2:00\u00a0PM");
  });

  it("keeps both meridiems when the range crosses noon", () => {
    const start = new Date("2026-10-14T15:30:00Z");
    expect(formatTimeRange(start, WED_2PM, NY)).toMatch(/^11:30\sAM\s*\u2013\s*2:00\sPM$/);
  });
});

describe("dates", () => {
  it("formats the VOICE date styles", () => {
    expect(formatDateShort(WED_2PM, NY)).toBe("Oct 14");
    expect(formatDateWeekday(WED_2PM, NY)).toBe("Wed, Oct 14");
    expect(formatDayHeading(WED_2PM, NY)).toBe("Wednesday, October 14");
    expect(formatDateFull(WED_2PM, NY)).toBe("Oct 14, 2026");
    expect(formatDateTime(WED_2PM, NY)).toMatch(/^Wed, Oct 14 at 2:00\sPM$/);
  });

  it("adds the year only for other years", () => {
    const now = new Date("2026-12-01T12:00:00Z");
    expect(formatDate(WED_2PM, { ...NY, now })).toBe("Oct 14");
    expect(formatDate(new Date("2025-03-02T12:00:00Z"), { ...NY, now })).toBe("Mar 2, 2025");
  });

  it("uses the time zone to pick the calendar day", () => {
    // 02:00 UTC on Oct 15 is still Oct 14 in New York
    const lateEvening = new Date("2026-10-15T02:00:00Z");
    expect(calendarDay(lateEvening, "America/New_York")).toEqual({ year: 2026, month: 10, day: 14 });
    expect(calendarDay(lateEvening, "UTC")).toEqual({ year: 2026, month: 10, day: 15 });
  });

  it("accepts ISO strings and timestamps", () => {
    expect(formatDateShort("2026-10-14T18:00:00Z", NY)).toBe("Oct 14");
    expect(formatDateShort(WED_2PM.getTime(), NY)).toBe("Oct 14");
  });
});

describe("relative days", () => {
  const now = new Date("2026-10-14T16:00:00Z"); // noon in New York

  it("counts calendar days, not 24-hour blocks", () => {
    // 11:30 PM tonight in New York is still today
    expect(daysUntil(new Date("2026-10-15T03:30:00Z"), { ...NY, now })).toBe(0);
    // 12:30 AM tomorrow is one day away even though it is 12.5 hours off
    expect(daysUntil(new Date("2026-10-15T04:30:00Z"), { ...NY, now })).toBe(1);
  });

  it("crosses a daylight saving change cleanly", () => {
    const beforeChange = new Date("2026-10-31T16:00:00Z");
    const afterChange = new Date("2026-11-02T17:00:00Z");
    expect(daysUntil(afterChange, { ...NY, now: beforeChange })).toBe(2);
  });

  it("reads today, tomorrow, yesterday and counts", () => {
    expect(formatRelativeDay(now, { ...NY, now })).toBe("today");
    expect(formatRelativeDay(new Date("2026-10-15T16:00:00Z"), { ...NY, now })).toBe("tomorrow");
    expect(formatRelativeDay(new Date("2026-10-13T16:00:00Z"), { ...NY, now })).toBe("yesterday");
    expect(formatRelativeDay(new Date("2026-10-21T16:00:00Z"), { ...NY, now })).toBe("in 7 days");
    expect(formatRelativeDay(new Date("2026-10-11T16:00:00Z"), { ...NY, now })).toBe("3 days ago");
  });
});

describe("countdowns", () => {
  const now = new Date("2026-10-14T16:00:00Z");

  it("writes each of the four messages", () => {
    expect(formatCountdown("Prelim 1", now, { ...NY, now })).toBe("Prelim 1 is today");
    expect(formatCountdown("Prelim 1", "2026-10-15T16:00:00Z", { ...NY, now })).toBe("Prelim 1 is tomorrow");
    expect(formatCountdown("Prelim 1", "2026-10-23T16:00:00Z", { ...NY, now })).toBe("Prelim 1 is in 9 days");
    expect(formatCountdown("Prelim 1", "2026-10-12T16:00:00Z", { ...NY, now })).toBe("Prelim 1 was 2 days ago");
    expect(formatCountdown("Prelim 1", "2026-10-13T16:00:00Z", { ...NY, now })).toBe("Prelim 1 was 1 day ago");
  });
});

describe("numbers", () => {
  it("formats counts, percentages and durations", () => {
    expect(formatNumber(1234)).toBe("1,234");
    expect(formatPercent(0.834)).toBe("83%");
    expect(formatPercent(1)).toBe("100%");
    expect(formatDuration(25)).toBe("25 min");
    expect(formatDuration(119)).toBe("119 min");
    expect(formatDuration(150)).toBe("2.5 hr");
    expect(formatDuration(120)).toBe("2 hr");
    expect(formatDuration(0.4)).toBe("Under 1 min");
  });
});

describe("plural", () => {
  const sessions = { zero: "No sessions today", one: "# session today", other: "# sessions today" };

  it("picks one whole message per count", () => {
    expect(plural(0, sessions)).toBe("No sessions today");
    expect(plural(1, sessions)).toBe("1 session today");
    expect(plural(2, sessions)).toBe("2 sessions today");
    expect(plural(1500, sessions)).toBe("1,500 sessions today");
  });

  it("falls back to other for zero when no zero form is given", () => {
    expect(plural(0, { one: "# card", other: "# cards" })).toBe("0 cards");
  });

  it("never writes '1 sessions'", () => {
    expect(plural(1, { one: "# session", other: "# sessions" })).not.toMatch(/1 sessions/);
  });
});

describe("lists", () => {
  it("uses the serial comma", () => {
    expect(formatList(["Recursion", "Stacks", "Big-O"])).toBe("Recursion, Stacks, and Big-O");
    expect(formatList(["Recursion", "Stacks"])).toBe("Recursion and Stacks");
    expect(formatList(["Recursion"])).toBe("Recursion");
    expect(formatList(["Sure", "Unsure"], "disjunction")).toBe("Sure or Unsure");
  });
});
