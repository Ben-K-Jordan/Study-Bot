import { describe, it, expect } from "vitest";
import { generateIcs, IcsEvent } from "@/lib/ics";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseIcsEvents(ics: string): Record<string, string>[] {
  const events: Record<string, string>[] = [];
  // Unfold continuation lines first (lines starting with space after CRLF)
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  const lines = unfolded.split(/\r\n/);
  let current: Record<string, string> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      current = {};
    } else if (line === "END:VEVENT" && current) {
      events.push(current);
      current = null;
    } else if (current && line.includes(":")) {
      const colonIdx = line.indexOf(":");
      const key = line.slice(0, colonIdx);
      const value = line.slice(colonIdx + 1);
      current[key] = value;
    }
  }
  return events;
}

const sampleEvents: IcsEvent[] = [
  {
    uid: "plan-123-sess-1-2024-01-15T14:00:00Z",
    summary: "CS 2110 | Prelim 1 | Retrieval: Loops",
    description: "Study session\nLink: https://example.com/s/abc123",
    dtstart: new Date("2024-01-15T14:00:00Z"),
    dtend: new Date("2024-01-15T15:30:00Z"),
  },
  {
    uid: "plan-123-sess-2-2024-01-16T10:00:00Z",
    summary: "CS 2110 | Prelim 1 | Interleaved Practice: All",
    description: "Mixed practice session\nhttps://example.com/s/def456",
    dtstart: new Date("2024-01-16T10:00:00Z"),
    dtend: new Date("2024-01-16T11:00:00Z"),
  },
];

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

describe("ics: structure", () => {
  it("produces valid VCALENDAR envelope", () => {
    const ics = generateIcs(sampleEvents);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:-//StudyBot//WeekPlanner//EN");
    expect(ics).toContain("CALSCALE:GREGORIAN");
    expect(ics).toContain("METHOD:PUBLISH");
  });

  it("uses CRLF line endings throughout", () => {
    const ics = generateIcs(sampleEvents);
    // Remove all CRLF — remaining should have no bare LF
    const withoutCR = ics.replace(/\r\n/g, "");
    expect(withoutCR).not.toContain("\n");
  });

  it("contains correct number of VEVENT blocks", () => {
    const ics = generateIcs(sampleEvents);
    const eventStarts = (ics.match(/BEGIN:VEVENT/g) || []).length;
    const eventEnds = (ics.match(/END:VEVENT/g) || []).length;
    expect(eventStarts).toBe(2);
    expect(eventEnds).toBe(2);
  });

  it("handles empty event list", () => {
    const ics = generateIcs([]);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

// ---------------------------------------------------------------------------
// Field validation (parsed)
// ---------------------------------------------------------------------------

describe("ics: parsed field validation", () => {
  it("every event has UID, DTSTART, DTEND, SUMMARY, DESCRIPTION", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);
    expect(parsed).toHaveLength(2);

    for (const event of parsed) {
      expect(event["UID"], "UID missing").toBeDefined();
      expect(event["DTSTART"], "DTSTART missing").toBeDefined();
      expect(event["DTEND"], "DTEND missing").toBeDefined();
      expect(event["SUMMARY"], "SUMMARY missing").toBeDefined();
      expect(event["DESCRIPTION"], "DESCRIPTION missing").toBeDefined();
      expect(event["DTSTAMP"], "DTSTAMP missing").toBeDefined();
    }
  });

  it("DTSTART comes before DTEND for each event", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);

    for (const event of parsed) {
      const start = event["DTSTART"];
      const end = event["DTEND"];
      expect(start < end, `DTSTART ${start} should be before DTEND ${end}`).toBe(true);
    }
  });

  it("DTSTART/DTEND are in UTC format (ending with Z)", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);

    for (const event of parsed) {
      expect(event["DTSTART"]).toMatch(/^\d{8}T\d{6}Z$/);
      expect(event["DTEND"]).toMatch(/^\d{8}T\d{6}Z$/);
    }
  });

  it("DTSTART matches the input date", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);
    expect(parsed[0]["DTSTART"]).toBe("20240115T140000Z");
    expect(parsed[0]["DTEND"]).toBe("20240115T153000Z");
    expect(parsed[1]["DTSTART"]).toBe("20240116T100000Z");
    expect(parsed[1]["DTEND"]).toBe("20240116T110000Z");
  });

  it("SUMMARY contains expected text", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);
    expect(parsed[0]["SUMMARY"]).toContain("Retrieval: Loops");
    expect(parsed[1]["SUMMARY"]).toContain("Interleaved Practice");
  });
});

// ---------------------------------------------------------------------------
// No duplicate UIDs
// ---------------------------------------------------------------------------

describe("ics: UID uniqueness", () => {
  it("produces no duplicate UIDs", () => {
    const ics = generateIcs(sampleEvents);
    const parsed = parseIcsEvents(ics);
    const uids = parsed.map((e) => e["UID"]);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("produces unique UIDs for many events", () => {
    const manyEvents: IcsEvent[] = Array.from({ length: 20 }, (_, i) => ({
      uid: `plan-abc-sess-${i}-2024-01-${String(15 + (i % 7)).padStart(2, "0")}`,
      summary: `Session ${i}`,
      description: `Desc ${i}`,
      dtstart: new Date(`2024-01-${String(15 + (i % 7)).padStart(2, "0")}T${String(8 + i).padStart(2, "0")}:00:00Z`),
      dtend: new Date(`2024-01-${String(15 + (i % 7)).padStart(2, "0")}T${String(9 + i).padStart(2, "0")}:00:00Z`),
    }));
    const ics = generateIcs(manyEvents);
    const parsed = parseIcsEvents(ics);
    const uids = parsed.map((e) => e["UID"]);
    expect(new Set(uids).size).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

describe("ics: text escaping", () => {
  it("escapes semicolons, commas, and backslashes", () => {
    const events: IcsEvent[] = [
      {
        uid: "test-escape",
        summary: "Test; with, special\\chars",
        description: "A; B, C\\D",
        dtstart: new Date("2024-01-15T14:00:00Z"),
        dtend: new Date("2024-01-15T15:00:00Z"),
      },
    ];
    const ics = generateIcs(events);
    expect(ics).toContain("Test\\; with\\, special\\\\chars");
    expect(ics).toContain("A\\; B\\, C\\\\D");
  });

  it("escapes newlines as \\n", () => {
    const events: IcsEvent[] = [
      {
        uid: "test-newline",
        summary: "Title",
        description: "Line 1\nLine 2\nLine 3",
        dtstart: new Date("2024-01-15T14:00:00Z"),
        dtend: new Date("2024-01-15T15:00:00Z"),
      },
    ];
    const ics = generateIcs(events);
    expect(ics).toContain("Line 1\\nLine 2\\nLine 3");
  });
});

// ---------------------------------------------------------------------------
// Deep link in DESCRIPTION
// ---------------------------------------------------------------------------

describe("ics: session deep links", () => {
  it("DESCRIPTION preserves session URL (/s/{session_id})", () => {
    const events: IcsEvent[] = [
      {
        uid: "link-test",
        summary: "Study",
        description: "Session: https://example.com/s/abc123XYZ",
        dtstart: new Date("2024-01-15T14:00:00Z"),
        dtend: new Date("2024-01-15T15:00:00Z"),
      },
    ];
    const ics = generateIcs(events);
    // The /s/ path should be preserved (colon in https gets escaped)
    expect(ics).toContain("/s/abc123XYZ");
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe("ics: determinism", () => {
  it("generates stable output for same input (ignoring DTSTAMP)", () => {
    const run1 = generateIcs(sampleEvents);
    const run2 = generateIcs(sampleEvents);
    // DTSTAMP changes with current time, strip it for comparison
    const strip = (s: string) =>
      s.replace(/DTSTAMP:\d{8}T\d{6}Z/g, "DTSTAMP:STRIPPED");
    expect(strip(run1)).toBe(strip(run2));
  });
});
