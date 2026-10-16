/**
 * Exam dates on the Cards pages: a calendar date reads the same in every
 * time zone, and the countdown counts calendar days from today on the
 * student's clock, east of UTC+12 included.
 */
import { describe, it, expect } from "vitest";

import { examCountdown, examDateLabel } from "@/components/cards/card-format";

describe("examDateLabel", () => {
  it("shows the stored calendar date", () => {
    expect(examDateLabel("2026-10-22")).toBe("Thu, Oct 22");
    expect(examDateLabel("2026-10-22T00:00:00.000Z")).toBe("Thu, Oct 22");
  });
});

describe("examCountdown", () => {
  it("counts days on the student's clock in Auckland during NZDT (UTC+13)", () => {
    // 9:00 AM Thu, Oct 15 in Auckland
    const now = new Date("2026-10-14T20:00:00Z");
    expect(examCountdown("Prelim 1", "2026-10-22", { timeZone: "Pacific/Auckland", now })).toBe(
      "Prelim 1 is in 7 days"
    );
    expect(examCountdown("Prelim 1", "2026-10-15", { timeZone: "Pacific/Auckland", now })).toBe("Prelim 1 is today");
  });

  it("counts days on the student's clock west of UTC", () => {
    // 8:00 PM Wed, Oct 14 in Honolulu (UTC-10), already Oct 15 in UTC
    const now = new Date("2026-10-15T06:00:00Z");
    expect(examCountdown("Prelim 1", "2026-10-15", { timeZone: "Pacific/Honolulu", now })).toBe(
      "Prelim 1 is tomorrow"
    );
    expect(examCountdown("Final", "2026-10-12", { timeZone: "Pacific/Honolulu", now })).toBe("Final was 2 days ago");
  });

  it("counts in UTC without a zone", () => {
    const now = new Date("2026-10-15T23:30:00Z");
    expect(examCountdown("Prelim 1", "2026-10-16", { now })).toBe("Prelim 1 is tomorrow");
  });
});
