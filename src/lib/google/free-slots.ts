/**
 * Compute free slots from busy intervals within preferred availability windows.
 * Used by availability-aware plan generation.
 */

export interface TimeInterval {
  start: number; // unix ms
  end: number;   // unix ms
}

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
