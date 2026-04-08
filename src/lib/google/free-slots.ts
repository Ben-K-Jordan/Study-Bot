/**
 * Compute free slots from busy intervals within preferred availability windows.
 * Used by availability-aware plan generation.
 *
 * Enhanced with:
 * - Event filtering (declined/transparent events excluded from busy time)
 * - Buffer time between events (context-switching padding)
 * - Travel time estimation from event locations
 */

import type { CalendarEvent } from "@/lib/google/calendar-client";

export interface TimeInterval {
  start: number; // unix ms
  end: number;   // unix ms
}

/** Default buffer time (minutes) added after each busy block for context switching */
const DEFAULT_BUFFER_MINUTES = 10;

/** Extra travel buffer (minutes) when an event has a physical location */
const TRAVEL_BUFFER_MINUTES = 15;

/** Keywords suggesting a physical location (not virtual) */
const VIRTUAL_KEYWORDS = [
  "zoom", "meet", "teams", "webex", "hangout", "virtual",
  "online", "remote", "http", "https", "call",
];

/**
 * Merge overlapping/adjacent busy intervals into a sorted, non-overlapping list.
 */
export function mergeBusy(intervals: TimeInterval[]): TimeInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeInterval[] = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end);
    } else {
      merged.push({ ...sorted[i] });
    }
  }
  return merged;
}

/**
 * Filter calendar events to only those that actually block time.
 * Removes:
 * - Declined events (selfResponseStatus === "declined")
 * - Cancelled events (status === "cancelled")
 * - Transparent/free events (transparency === "transparent")
 *
 * Returns events that should be treated as busy.
 */
export function filterBusyEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((e) => {
    // Skip cancelled events
    if (e.status === "cancelled") return false;
    // Skip events the user declined
    if (e.selfResponseStatus === "declined") return false;
    // Skip events marked as "free" / transparent
    if (e.transparency === "transparent") return false;
    // Skip events with empty start/end (shouldn't happen but defensive)
    if (!e.start || !e.end) return false;
    return true;
  });
}

/**
 * Convert filtered calendar events to busy intervals with buffer time.
 *
 * For each event:
 * - Adds DEFAULT_BUFFER_MINUTES after the event for context switching
 * - Adds TRAVEL_BUFFER_MINUTES before events with physical locations
 * - All-day events block the entire day
 */
export function eventsToBufferedIntervals(
  events: CalendarEvent[],
  bufferMinutes: number = DEFAULT_BUFFER_MINUTES,
): TimeInterval[] {
  const MS_PER_MIN = 60 * 1000;
  const intervals: TimeInterval[] = [];

  for (const event of events) {
    const start = new Date(event.start).getTime();
    const end = new Date(event.end).getTime();

    if (isNaN(start) || isNaN(end) || end <= start) continue;

    // Determine if event has a physical location requiring travel
    const hasPhysicalLocation = event.location
      ? !VIRTUAL_KEYWORDS.some((kw) => event.location!.toLowerCase().includes(kw))
      : false;

    // Add travel buffer before events with physical locations
    const effectiveStart = hasPhysicalLocation
      ? start - TRAVEL_BUFFER_MINUTES * MS_PER_MIN
      : start;

    // Add context-switching buffer after the event
    const effectiveEnd = end + bufferMinutes * MS_PER_MIN;

    intervals.push({ start: effectiveStart, end: effectiveEnd });
  }

  return intervals;
}

/**
 * Check if a location string indicates a physical (non-virtual) location.
 * Exported for testing.
 */
export function isPhysicalLocation(location: string | undefined): boolean {
  if (!location) return false;
  return !VIRTUAL_KEYWORDS.some((kw) => location.toLowerCase().includes(kw));
}

/**
 * Compute free slots within a given window, subtracting busy intervals.
 * Returns sorted non-overlapping free intervals.
 */
export function computeFreeSlots(
  windowStart: number,
  windowEnd: number,
  busy: TimeInterval[]
): TimeInterval[] {
  const merged = mergeBusy(busy.filter((b) => b.start < windowEnd && b.end > windowStart));
  const free: TimeInterval[] = [];
  let cursor = windowStart;

  for (const b of merged) {
    const busyStart = Math.max(b.start, windowStart);
    if (cursor < busyStart) {
      free.push({ start: cursor, end: busyStart });
    }
    cursor = Math.max(cursor, Math.min(b.end, windowEnd));
  }

  if (cursor < windowEnd) {
    free.push({ start: cursor, end: windowEnd });
  }

  return free;
}

/**
 * Fit study blocks into free slots. Returns scheduled blocks with start/end times.
 * Blocks are scheduled greedily into the first available free slot.
 * If a free slot is larger than needed, only the required portion is used.
 */
export function fitBlocksIntoSlots(
  blockDurationsMs: number[],
  freeSlots: TimeInterval[]
): (TimeInterval | null)[] {
  // Track remaining free time in each slot
  const slotStarts = freeSlots.map((s) => s.start);
  const slotEnds = freeSlots.map((s) => s.end);

  return blockDurationsMs.map((dur) => {
    for (let i = 0; i < slotStarts.length; i++) {
      const available = slotEnds[i] - slotStarts[i];
      if (available >= dur) {
        const start = slotStarts[i];
        const end = start + dur;
        slotStarts[i] = end; // consume this portion
        return { start, end };
      }
    }
    return null; // no slot big enough
  });
}
