/**
 * Unit tests for the pure helpers in lib/timezone. Every expectation is an
 * absolute instant or a day key, so the results must not depend on the
 * timezone of the machine running the tests.
 */
import { describe, it, expect } from "vitest";
import { addDays, dayKey, daysBetween, hourOfDay, zonedTimeToUtc } from "@/lib/timezone";

describe("zonedTimeToUtc", () => {
  it("converts a wall-clock time in a zone to the UTC instant", () => {
    // 09:00 EDT (UTC-4)
    expect(zonedTimeToUtc("2026-07-16", "09:00", "America/New_York").toISOString()).toBe(
      "2026-07-16T13:00:00.000Z",
    );
    // 09:00 JST (UTC+9) is the previous UTC day
    expect(zonedTimeToUtc("2026-07-16", "09:00", "Asia/Tokyo").toISOString()).toBe(
      "2026-07-16T00:00:00.000Z",
    );
  });

  it("follows DST on both sides of a transition", () => {
    // US clocks spring forward on 2026-03-08
    expect(zonedTimeToUtc("2026-03-07", "09:00", "America/New_York").toISOString()).toBe(
      "2026-03-07T14:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-03-08", "09:00", "America/New_York").toISOString()).toBe(
      "2026-03-08T13:00:00.000Z",
    );
  });

  it("treats a null or invalid zone as UTC", () => {
    expect(zonedTimeToUtc("2026-07-16", "09:30", null).toISOString()).toBe(
      "2026-07-16T09:30:00.000Z",
    );
    expect(zonedTimeToUtc("2026-07-16", "09:30", "Not/AZone").toISOString()).toBe(
      "2026-07-16T09:30:00.000Z",
    );
  });
});

describe("day arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("counts calendar days between day keys", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
  });

  it("reads the calendar day and hour in the given zone", () => {
    const instant = new Date("2026-07-17T02:30:00Z");
    expect(dayKey(instant, "America/New_York")).toBe("2026-07-16");
    expect(dayKey(instant, null)).toBe("2026-07-17");
    expect(hourOfDay(instant, "America/New_York")).toBe(22.5);
    expect(hourOfDay(instant, null)).toBe(2.5);
  });
});
