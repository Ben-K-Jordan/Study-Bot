/**
 * Unit tests for free-slot computation and crypto roundtrip.
 */
import { describe, it, expect } from "vitest";
import { mergeBusy, computeFreeSlots, fitBlocksIntoSlots, filterBusyEvents, eventsToBufferedIntervals, isPhysicalLocation, type TimeInterval } from "@/lib/google/free-slots";
import type { CalendarEvent } from "@/lib/google/calendar-client";

describe("mergeBusy", () => {
  it("returns empty for empty input", () => {
    expect(mergeBusy([])).toEqual([]);
  });

  it("returns single interval unchanged", () => {
    const intervals: TimeInterval[] = [{ start: 100, end: 200 }];
    expect(mergeBusy(intervals)).toEqual([{ start: 100, end: 200 }]);
  });

  it("merges overlapping intervals", () => {
    const intervals: TimeInterval[] = [
      { start: 100, end: 300 },
      { start: 200, end: 400 },
    ];
    expect(mergeBusy(intervals)).toEqual([{ start: 100, end: 400 }]);
  });

  it("merges adjacent intervals", () => {
    const intervals: TimeInterval[] = [
      { start: 100, end: 200 },
      { start: 200, end: 300 },
    ];
    expect(mergeBusy(intervals)).toEqual([{ start: 100, end: 300 }]);
  });

  it("does not merge non-overlapping intervals", () => {
    const intervals: TimeInterval[] = [
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ];
    expect(mergeBusy(intervals)).toEqual([
      { start: 100, end: 200 },
      { start: 300, end: 400 },
    ]);
  });

  it("handles unsorted input", () => {
    const intervals: TimeInterval[] = [
      { start: 300, end: 400 },
      { start: 100, end: 250 },
      { start: 200, end: 350 },
    ];
    expect(mergeBusy(intervals)).toEqual([{ start: 100, end: 400 }]);
  });

  it("merges multiple groups", () => {
    const intervals: TimeInterval[] = [
      { start: 100, end: 200 },
      { start: 150, end: 250 },
      { start: 500, end: 600 },
      { start: 550, end: 700 },
    ];
    expect(mergeBusy(intervals)).toEqual([
      { start: 100, end: 250 },
      { start: 500, end: 700 },
    ]);
  });
});

describe("computeFreeSlots", () => {
  const h = (hours: number) => hours * 3600000; // hours to ms

  it("returns full window when no busy intervals", () => {
    const free = computeFreeSlots(h(9), h(17), []);
    expect(free).toEqual([{ start: h(9), end: h(17) }]);
  });

  it("subtracts a single busy interval in the middle", () => {
    const free = computeFreeSlots(h(9), h(17), [{ start: h(12), end: h(13) }]);
    expect(free).toEqual([
      { start: h(9), end: h(12) },
      { start: h(13), end: h(17) },
    ]);
  });

  it("handles busy at the start of window", () => {
    const free = computeFreeSlots(h(9), h(17), [{ start: h(9), end: h(10) }]);
    expect(free).toEqual([{ start: h(10), end: h(17) }]);
  });

  it("handles busy at the end of window", () => {
    const free = computeFreeSlots(h(9), h(17), [{ start: h(16), end: h(17) }]);
    expect(free).toEqual([{ start: h(9), end: h(16) }]);
  });

  it("returns empty when entirely busy", () => {
    const free = computeFreeSlots(h(9), h(17), [{ start: h(8), end: h(18) }]);
    expect(free).toEqual([]);
  });

  it("clips busy intervals to window boundaries", () => {
    const free = computeFreeSlots(h(9), h(17), [{ start: h(7), end: h(10) }]);
    expect(free).toEqual([{ start: h(10), end: h(17) }]);
  });

  it("handles multiple busy intervals with gaps", () => {
    const free = computeFreeSlots(h(9), h(17), [
      { start: h(10), end: h(11) },
      { start: h(14), end: h(15) },
    ]);
    expect(free).toEqual([
      { start: h(9), end: h(10) },
      { start: h(11), end: h(14) },
      { start: h(15), end: h(17) },
    ]);
  });
});

describe("fitBlocksIntoSlots", () => {
  const h = (hours: number) => hours * 3600000;
  const min = (minutes: number) => minutes * 60000;

  it("fits a single block into a large slot", () => {
    const slots: TimeInterval[] = [{ start: h(9), end: h(17) }];
    const result = fitBlocksIntoSlots([min(60)], slots);
    expect(result).toEqual([{ start: h(9), end: h(10) }]);
  });

  it("fits multiple blocks sequentially in one slot", () => {
    const slots: TimeInterval[] = [{ start: h(9), end: h(17) }];
    const result = fitBlocksIntoSlots([min(60), min(30)], slots);
    expect(result).toEqual([
      { start: h(9), end: h(10) },
      { start: h(10), end: h(10) + min(30) },
    ]);
  });

  it("spills into next slot when first is too small", () => {
    const slots: TimeInterval[] = [
      { start: h(9), end: h(9) + min(30) },
      { start: h(12), end: h(17) },
    ];
    const result = fitBlocksIntoSlots([min(60)], slots);
    expect(result).toEqual([{ start: h(12), end: h(13) }]);
  });

  it("returns null when no slot is large enough", () => {
    const slots: TimeInterval[] = [
      { start: h(9), end: h(9) + min(30) },
      { start: h(12), end: h(12) + min(30) },
    ];
    const result = fitBlocksIntoSlots([min(60)], slots);
    expect(result).toEqual([null]);
  });

  it("handles empty blocks list", () => {
    const slots: TimeInterval[] = [{ start: h(9), end: h(17) }];
    expect(fitBlocksIntoSlots([], slots)).toEqual([]);
  });

  it("handles empty slots", () => {
    const result = fitBlocksIntoSlots([min(60)], []);
    expect(result).toEqual([null]);
  });

  it("does not schedule overlapping blocks", () => {
    const slots: TimeInterval[] = [{ start: h(9), end: h(11) }];
    const result = fitBlocksIntoSlots([min(60), min(60), min(60)], slots);
    expect(result[0]).toEqual({ start: h(9), end: h(10) });
    expect(result[1]).toEqual({ start: h(10), end: h(11) });
    expect(result[2]).toBeNull(); // no room
  });
});

// ---------------------------------------------------------------------------
// filterBusyEvents
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "evt_1",
    summary: "Meeting",
    start: "2026-04-10T10:00:00Z",
    end: "2026-04-10T11:00:00Z",
    ...overrides,
  };
}

describe("filterBusyEvents", () => {
  it("keeps normal confirmed events", () => {
    const events = [makeEvent({ status: "confirmed" })];
    expect(filterBusyEvents(events)).toHaveLength(1);
  });

  it("removes declined events", () => {
    const events = [makeEvent({ selfResponseStatus: "declined" })];
    expect(filterBusyEvents(events)).toHaveLength(0);
  });

  it("removes cancelled events", () => {
    const events = [makeEvent({ status: "cancelled" })];
    expect(filterBusyEvents(events)).toHaveLength(0);
  });

  it("removes transparent (free) events", () => {
    const events = [makeEvent({ transparency: "transparent" })];
    expect(filterBusyEvents(events)).toHaveLength(0);
  });

  it("keeps tentative events (they still block time)", () => {
    const events = [makeEvent({ selfResponseStatus: "tentative" })];
    expect(filterBusyEvents(events)).toHaveLength(1);
  });

  it("keeps events with no response status (organizer events)", () => {
    const events = [makeEvent({ selfResponseStatus: undefined })];
    expect(filterBusyEvents(events)).toHaveLength(1);
  });

  it("removes events with empty start/end", () => {
    const events = [makeEvent({ start: "", end: "" })];
    expect(filterBusyEvents(events)).toHaveLength(0);
  });

  it("handles mixed events correctly", () => {
    const events = [
      makeEvent({ id: "1", status: "confirmed" }),                    // keep
      makeEvent({ id: "2", selfResponseStatus: "declined" }),         // drop
      makeEvent({ id: "3", transparency: "transparent" }),            // drop
      makeEvent({ id: "4", status: "cancelled" }),                    // drop
      makeEvent({ id: "5", selfResponseStatus: "accepted" }),         // keep
    ];
    const result = filterBusyEvents(events);
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(["1", "5"]);
  });
});

// ---------------------------------------------------------------------------
// eventsToBufferedIntervals
// ---------------------------------------------------------------------------

describe("eventsToBufferedIntervals", () => {
  it("adds default 10-minute buffer after events", () => {
    const events = [makeEvent({
      start: "2026-04-10T10:00:00Z",
      end: "2026-04-10T11:00:00Z",
    })];
    const intervals = eventsToBufferedIntervals(events);
    expect(intervals).toHaveLength(1);
    const endWithBuffer = new Date("2026-04-10T11:00:00Z").getTime() + 10 * 60 * 1000;
    expect(intervals[0].end).toBe(endWithBuffer);
  });

  it("adds travel buffer before events with physical locations", () => {
    const events = [makeEvent({
      start: "2026-04-10T10:00:00Z",
      end: "2026-04-10T11:00:00Z",
      location: "Room 302, Engineering Building",
    })];
    const intervals = eventsToBufferedIntervals(events);
    const startWithTravel = new Date("2026-04-10T10:00:00Z").getTime() - 15 * 60 * 1000;
    expect(intervals[0].start).toBe(startWithTravel);
  });

  it("does NOT add travel buffer for virtual meetings", () => {
    const events = [makeEvent({
      start: "2026-04-10T10:00:00Z",
      end: "2026-04-10T11:00:00Z",
      location: "https://zoom.us/j/123456",
    })];
    const intervals = eventsToBufferedIntervals(events);
    expect(intervals[0].start).toBe(new Date("2026-04-10T10:00:00Z").getTime());
  });

  it("respects custom buffer minutes", () => {
    const events = [makeEvent({
      start: "2026-04-10T10:00:00Z",
      end: "2026-04-10T11:00:00Z",
    })];
    const intervals = eventsToBufferedIntervals(events, 20);
    const endWithBuffer = new Date("2026-04-10T11:00:00Z").getTime() + 20 * 60 * 1000;
    expect(intervals[0].end).toBe(endWithBuffer);
  });

  it("handles all-day events", () => {
    const events = [makeEvent({
      start: "2026-04-10T00:00:00",
      end: "2026-04-10T23:59:59",
      allDay: true,
    })];
    const intervals = eventsToBufferedIntervals(events);
    expect(intervals).toHaveLength(1);
    // All-day event should produce a valid interval
    expect(intervals[0].end).toBeGreaterThan(intervals[0].start);
  });

  it("skips events with invalid dates", () => {
    const events = [makeEvent({ start: "", end: "" })];
    const intervals = eventsToBufferedIntervals(events);
    expect(intervals).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isPhysicalLocation
// ---------------------------------------------------------------------------

describe("isPhysicalLocation", () => {
  it("returns false for undefined", () => {
    expect(isPhysicalLocation(undefined)).toBe(false);
  });

  it("returns false for Zoom links", () => {
    expect(isPhysicalLocation("https://zoom.us/j/123")).toBe(false);
  });

  it("returns false for Google Meet", () => {
    expect(isPhysicalLocation("meet.google.com/abc-def")).toBe(false);
  });

  it("returns false for Teams links", () => {
    expect(isPhysicalLocation("Microsoft Teams Meeting")).toBe(false);
  });

  it("returns true for room numbers", () => {
    expect(isPhysicalLocation("Room 302, Engineering Hall")).toBe(true);
  });

  it("returns true for street addresses", () => {
    expect(isPhysicalLocation("123 Main St, Building A")).toBe(true);
  });

  it("returns true for campus locations", () => {
    expect(isPhysicalLocation("Library Study Room 4B")).toBe(true);
  });
});
