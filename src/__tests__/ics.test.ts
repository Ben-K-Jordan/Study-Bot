import { describe, it, expect } from "vitest";
import { generateIcs, IcsEvent } from "@/lib/ics";

describe("ics", () => {
  const sampleEvents: IcsEvent[] = [
    {
      uid: "plan-123-sess-1-2024-01-15",
      summary: "CS 2110 | Prelim 1 | Retrieval: Loops",
      description: "Study session\\nLink: https://example.com/s/abc",
      dtstart: new Date("2024-01-15T14:00:00Z"),
      dtend: new Date("2024-01-15T15:30:00Z"),
    },
    {
      uid: "plan-123-sess-2-2024-01-16",
      summary: "CS 2110 | Prelim 1 | Interleaved Practice: All",
      description: "Mixed practice session",
      dtstart: new Date("2024-01-16T10:00:00Z"),
      dtend: new Date("2024-01-16T11:00:00Z"),
    },
  ];

  it("produces valid VCALENDAR structure", () => {
    const ics = generateIcs(sampleEvents);

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//StudyBot//WeekPlanner//EN");
  });

  it("contains correct number of VEVENT blocks", () => {
    const ics = generateIcs(sampleEvents);

    const eventStarts = (ics.match(/BEGIN:VEVENT/g) || []).length;
    const eventEnds = (ics.match(/END:VEVENT/g) || []).length;
    expect(eventStarts).toBe(2);
    expect(eventEnds).toBe(2);
  });

  it("includes UID, DTSTART, DTEND, SUMMARY for each event", () => {
    const ics = generateIcs(sampleEvents);

    expect(ics).toContain("UID:plan-123-sess-1-2024-01-15");
    expect(ics).toContain("UID:plan-123-sess-2-2024-01-16");
    expect(ics).toContain("DTSTART:20240115T140000Z");
    expect(ics).toContain("DTEND:20240115T153000Z");
    expect(ics).toContain("SUMMARY:CS 2110 | Prelim 1 | Retrieval: Loops");
  });

  it("escapes special characters in text fields", () => {
    const events: IcsEvent[] = [
      {
        uid: "test-1",
        summary: "Test; with, special chars",
        description: "Line 1\nLine 2",
        dtstart: new Date("2024-01-15T14:00:00Z"),
        dtend: new Date("2024-01-15T15:00:00Z"),
      },
    ];

    const ics = generateIcs(events);
    expect(ics).toContain("Test\\; with\\, special chars");
    expect(ics).toContain("Line 1\\nLine 2");
  });

  it("uses CRLF line endings", () => {
    const ics = generateIcs(sampleEvents);
    expect(ics).toContain("\r\n");
    // Should not have bare LF
    const withoutCR = ics.replace(/\r\n/g, "");
    expect(withoutCR).not.toContain("\n");
  });

  it("handles empty event list", () => {
    const ics = generateIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});
