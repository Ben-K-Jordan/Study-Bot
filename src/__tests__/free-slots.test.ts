/**
 * Unit tests for free-slot computation and crypto roundtrip.
 */
import { describe, it, expect } from "vitest";
import { mergeBusy, computeFreeSlots, fitBlocksIntoSlots, type TimeInterval } from "@/lib/google/free-slots";

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
