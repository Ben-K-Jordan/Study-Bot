/**
 * Unit tests for the pure helpers in lib/timezone. Every expectation is an
 * absolute instant or a day key, so the results must not depend on the
 * timezone of the machine running the tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const db = vi.hoisted(() => ({
  settingsZone: null as string | null,
  planZone: null as string | null,
  settingsReads: 0,
  planReads: 0,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    userGameState: {
      findUnique: async () => {
        db.settingsReads++;
        return { timezone: db.settingsZone };
      },
    },
    studyPlan: {
      findFirst: async () => {
        db.planReads++;
        return db.planZone === null ? null : { timezone: db.planZone };
      },
    },
  },
}));

import {
  addDays,
  dayKey,
  daysBetween,
  getStoredTimezone,
  getUserTimezone,
  hourOfDay,
  isValidTimezone,
  resolveTimeZone,
  zonedTimeToUtc,
} from "@/lib/timezone";

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

describe("formatter reuse", () => {
  it("gives the same answers when a zone's formatter is reused", () => {
    const instants = Array.from({ length: 48 }, (_, i) => new Date(Date.UTC(2026, 2, 7, i)));
    const first = instants.map((d) => dayKey(d, "America/New_York"));
    const again = instants.map((d) => dayKey(d, "America/New_York"));
    expect(again).toEqual(first);
    // Midnight in New York is 05:00 UTC on both days: clocks change at 2am on March 8
    expect(first[4]).toBe("2026-03-06");
    expect(first[5]).toBe("2026-03-07");
    expect(first[24 + 4]).toBe("2026-03-07");
    expect(first[24 + 5]).toBe("2026-03-08");
  });

  it("keeps zones apart", () => {
    const instant = new Date("2026-07-16T23:30:00Z");
    expect(dayKey(instant, "Asia/Tokyo")).toBe("2026-07-17");
    expect(dayKey(instant, "America/Los_Angeles")).toBe("2026-07-16");
    expect(hourOfDay(instant, "Asia/Tokyo")).toBe(8.5);
    expect(hourOfDay(instant, "America/Los_Angeles")).toBe(16.5);
  });

  it("reads midnight as hour 0", () => {
    expect(hourOfDay(new Date("2026-07-16T04:00:00Z"), "America/New_York")).toBe(0);
  });

  it("validates zones, valid or not, any number of times", () => {
    for (let i = 0; i < 3; i++) {
      expect(isValidTimezone("Europe/Paris")).toBe(true);
      expect(isValidTimezone("UTC")).toBe(true);
      expect(isValidTimezone("Not/AZone")).toBe(false);
      expect(isValidTimezone("")).toBe(false);
    }
    expect(dayKey(new Date("2026-07-17T02:30:00Z"), "Not/AZone")).toBe("2026-07-17");
  });
});

describe("the student's zone", () => {
  beforeEach(() => {
    db.settingsZone = null;
    db.planZone = null;
    db.settingsReads = 0;
    db.planReads = 0;
  });

  it("prefers the Settings zone", async () => {
    db.settingsZone = "America/Chicago";
    db.planZone = "Europe/Paris";
    expect(await resolveTimeZone("u1")).toBe("America/Chicago");
    expect(await getUserTimezone("u1")).toBe("America/Chicago");
    expect(db.planReads).toBe(0);
  });

  it("uses the newest plan's zone when Settings has none", async () => {
    db.planZone = "Europe/Paris";
    expect(await resolveTimeZone("u1")).toBe("Europe/Paris");
    expect(await getUserTimezone("u1")).toBe("Europe/Paris");
    // Settings itself stays empty
    expect(await getStoredTimezone("u1")).toBeNull();
  });

  it("ends at UTC, or null, with no valid zone anywhere", async () => {
    db.settingsZone = "Not/AZone";
    db.planZone = "Also/Not";
    expect(await resolveTimeZone("u1")).toBe("UTC");
    expect(await getUserTimezone("u1")).toBeNull();
  });

  it("skips the Settings query when the caller passes the value", async () => {
    db.planZone = "Europe/Paris";
    expect(await resolveTimeZone("u1", "Asia/Tokyo")).toBe("Asia/Tokyo");
    expect(await resolveTimeZone("u1", null)).toBe("Europe/Paris");
    expect(db.settingsReads).toBe(0);
  });
});
