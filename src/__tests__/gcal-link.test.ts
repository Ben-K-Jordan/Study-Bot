import { describe, it, expect } from "vitest";
import { buildGoogleCalendarLink } from "@/lib/gcal-link";

describe("buildGoogleCalendarLink", () => {
  it("generates a valid Google Calendar template URL", () => {
    const url = buildGoogleCalendarLink({
      title: "Study: Algorithms",
      startTime: new Date("2026-04-10T14:00:00Z"),
      endTime: new Date("2026-04-10T15:00:00Z"),
    });

    expect(url).toContain("https://calendar.google.com/calendar/render");
    expect(url).toContain("action=TEMPLATE");
    expect(url).toContain("text=Study%3A+Algorithms");
    expect(url).toContain("20260410T140000Z");
    expect(url).toContain("20260410T150000Z");
  });

  it("includes description and location when provided", () => {
    const url = buildGoogleCalendarLink({
      title: "Review",
      startTime: new Date("2026-05-01T09:00:00Z"),
      endTime: new Date("2026-05-01T10:00:00Z"),
      description: "Session notes here",
      location: "Library",
    });

    expect(url).toContain("details=Session+notes+here");
    expect(url).toContain("location=Library");
  });

  it("omits description and location when not provided", () => {
    const url = buildGoogleCalendarLink({
      title: "Test",
      startTime: new Date("2026-05-01T09:00:00Z"),
      endTime: new Date("2026-05-01T10:00:00Z"),
    });

    expect(url).not.toContain("details=");
    expect(url).not.toContain("location=");
  });
});
