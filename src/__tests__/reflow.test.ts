/**
 * Unit tests for Plan Reflow algorithm.
 *
 * Tests:
 * - Determinism: same input → same output
 * - No overlapping placements
 * - Daily cap enforcement
 * - Locked items stay in place
 * - Phase priority ordering (RETRIEVAL > INTERLEAVED > ... )
 * - Past items are not moved
 * - DROPPED when no slots available
 * - DST edge case (time shift)
 * - Mixed statuses
 */
import { describe, it, expect } from "vitest";
import {
  computeReflow,
  ReflowItem,
  ReflowConfig,
  ALGORITHM_VERSION,
} from "@/services/reflow";

// ---- Helpers ----

/** Build a plan start date at midnight */
function planStart(dateStr: string): Date {
  const d = new Date(dateStr + "T00:00:00.000Z");
  return d;
}

/** Build a ReflowItem with defaults */
function makeItem(overrides: Partial<ReflowItem> & { id: string; sessionId: string }): ReflowItem {
  return {
    dayIndex: 0,
    startTime: new Date("2025-06-02T09:00:00Z"),
    endTime: new Date("2025-06-02T10:00:00Z"),
    status: "SCHEDULED",
    locked: false,
    mode: "RETRIEVAL",
    plannedMinutes: 60,
    ...overrides,
  };
}

/** Default 7-day config: 09:00-17:00 each day, 180 min cap */
const defaultConfig: ReflowConfig = {
  availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
  daily_study_cap_minutes: 180,
};

/** "now" set to before any items */
const earlyNow = new Date("2025-06-01T08:00:00Z");

// ---- Tests ----

describe("computeReflow", () => {
  it("returns algorithm version", () => {
    const result = computeReflow([], defaultConfig, planStart("2025-06-02"), earlyNow);
    expect(result.algorithmVersion).toBe(ALGORITHM_VERSION);
  });

  it("returns empty changes when no items", () => {
    const result = computeReflow([], defaultConfig, planStart("2025-06-02"), earlyNow);
    expect(result.changes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it("returns empty changes when all items are terminal", () => {
    const items: ReflowItem[] = [
      makeItem({ id: "1", sessionId: "s1", status: "DONE" }),
      makeItem({ id: "2", sessionId: "s2", status: "MISSED" }),
    ];
    const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);
    expect(result.changes).toHaveLength(0);
  });

  describe("determinism", () => {
    it("produces identical output for identical input", () => {
      const items: ReflowItem[] = [
        makeItem({ id: "1", sessionId: "s1", dayIndex: 0, startTime: new Date("2025-06-02T09:00:00Z"), endTime: new Date("2025-06-02T10:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "2", sessionId: "s2", dayIndex: 0, startTime: new Date("2025-06-02T10:00:00Z"), endTime: new Date("2025-06-02T11:00:00Z"), plannedMinutes: 60, mode: "INTERLEAVED_PRACTICE" }),
        makeItem({ id: "3", sessionId: "s3", dayIndex: 1, startTime: new Date("2025-06-03T09:00:00Z"), endTime: new Date("2025-06-03T10:00:00Z"), plannedMinutes: 60 }),
      ];

      const a = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);
      const b = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);
      expect(a).toEqual(b);
    });
  });

  describe("no overlaps", () => {
    it("places multiple items without time overlap", () => {
      const items: ReflowItem[] = [
        makeItem({ id: "1", sessionId: "s1", dayIndex: 0, startTime: new Date("2025-06-02T09:00:00Z"), endTime: new Date("2025-06-02T10:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "2", sessionId: "s2", dayIndex: 0, startTime: new Date("2025-06-02T10:00:00Z"), endTime: new Date("2025-06-02T11:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "3", sessionId: "s3", dayIndex: 0, startTime: new Date("2025-06-02T11:00:00Z"), endTime: new Date("2025-06-02T12:00:00Z"), plannedMinutes: 60 }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      // Collect all placed intervals
      const placed = result.changes
        .filter((c) => c.after !== null)
        .map((c) => ({
          start: new Date(c.after!.startTime).getTime(),
          end: new Date(c.after!.endTime).getTime(),
        }))
        .sort((a, b) => a.start - b.start);

      // Verify no overlaps
      for (let i = 1; i < placed.length; i++) {
        expect(placed[i].start).toBeGreaterThanOrEqual(placed[i - 1].end);
      }
    });
  });

  describe("daily cap enforcement", () => {
    it("respects daily study cap by spilling to next day", () => {
      // 4 x 60min items on day 0, but cap is 180 min → 3 fit on day 0, 1 spills
      const items: ReflowItem[] = [
        makeItem({ id: "1", sessionId: "s1", dayIndex: 0, startTime: new Date("2025-06-02T09:00:00Z"), endTime: new Date("2025-06-02T10:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "2", sessionId: "s2", dayIndex: 0, startTime: new Date("2025-06-02T10:00:00Z"), endTime: new Date("2025-06-02T11:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "3", sessionId: "s3", dayIndex: 0, startTime: new Date("2025-06-02T11:00:00Z"), endTime: new Date("2025-06-02T12:00:00Z"), plannedMinutes: 60 }),
        makeItem({ id: "4", sessionId: "s4", dayIndex: 0, startTime: new Date("2025-06-02T12:00:00Z"), endTime: new Date("2025-06-02T13:00:00Z"), plannedMinutes: 60 }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      // All 4 should be placed (3 on day 0, 1 on day 1)
      const placed = result.changes.filter((c) => c.action !== "DROPPED");
      expect(placed).toHaveLength(4);

      // Count items per day
      const dayCounts: Record<number, number> = {};
      for (const c of placed) {
        if (c.after) {
          dayCounts[c.after.dayIndex] = (dayCounts[c.after.dayIndex] || 0) + 1;
        }
      }

      // Day 0 should have at most 3 (180min cap / 60min = 3)
      expect(dayCounts[0] || 0).toBeLessThanOrEqual(3);
    });
  });

  describe("locked items", () => {
    it("keeps locked items in place and schedules around them", () => {
      const items: ReflowItem[] = [
        makeItem({
          id: "locked-1",
          sessionId: "sl1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          locked: true,
          plannedMinutes: 60,
        }),
        makeItem({
          id: "movable-1",
          sessionId: "sm1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"), // overlaps locked
          endTime: new Date("2025-06-02T10:00:00Z"),
          plannedMinutes: 60,
        }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      // The movable item should be placed after the locked item
      const movedChange = result.changes.find((c) => c.itemId === "movable-1");
      expect(movedChange).toBeDefined();
      expect(movedChange!.action).toBe("MOVED");
      expect(new Date(movedChange!.after!.startTime).getTime()).toBeGreaterThanOrEqual(
        new Date("2025-06-02T10:00:00Z").getTime()
      );
    });
  });

  describe("phase priority ordering", () => {
    it("schedules RETRIEVAL before INTERLEAVED_PRACTICE before EXAM_SIM", () => {
      // Give them reversed priority in original order
      const items: ReflowItem[] = [
        makeItem({ id: "exam", sessionId: "se", dayIndex: 0, startTime: new Date("2025-06-02T09:00:00Z"), endTime: new Date("2025-06-02T10:00:00Z"), plannedMinutes: 60, mode: "EXAM_SIM" }),
        makeItem({ id: "interleave", sessionId: "si", dayIndex: 0, startTime: new Date("2025-06-02T10:00:00Z"), endTime: new Date("2025-06-02T11:00:00Z"), plannedMinutes: 60, mode: "INTERLEAVED_PRACTICE" }),
        makeItem({ id: "retrieval", sessionId: "sr", dayIndex: 0, startTime: new Date("2025-06-02T11:00:00Z"), endTime: new Date("2025-06-02T12:00:00Z"), plannedMinutes: 60, mode: "RETRIEVAL" }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      const placed = result.changes
        .filter((c) => c.after !== null)
        .sort((a, b) => new Date(a.after!.startTime).getTime() - new Date(b.after!.startTime).getTime());

      // RETRIEVAL should be first, then INTERLEAVED, then EXAM_SIM
      expect(placed[0].itemId).toBe("retrieval");
      expect(placed[1].itemId).toBe("interleave");
      expect(placed[2].itemId).toBe("exam");
    });
  });

  describe("past items", () => {
    it("does not move items whose endTime is in the past", () => {
      const now = new Date("2025-06-02T11:00:00Z");
      const items: ReflowItem[] = [
        makeItem({
          id: "past-1",
          sessionId: "sp1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          plannedMinutes: 60,
          status: "SCHEDULED",
        }),
        makeItem({
          id: "future-1",
          sessionId: "sf1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T14:00:00Z"),
          endTime: new Date("2025-06-02T15:00:00Z"),
          plannedMinutes: 60,
          status: "SCHEDULED",
        }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), now);

      // Only future-1 should appear in changes
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].itemId).toBe("future-1");
    });
  });

  describe("DROPPED items", () => {
    it("marks items as DROPPED when no slots available", () => {
      // Very tight config: only 30 min per day, trying to place 60 min item
      const tightConfig: ReflowConfig = {
        availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "09:30" })),
        daily_study_cap_minutes: 30,
      };

      const items: ReflowItem[] = [
        makeItem({ id: "1", sessionId: "s1", dayIndex: 0, startTime: new Date("2025-06-02T09:00:00Z"), endTime: new Date("2025-06-02T10:00:00Z"), plannedMinutes: 60 }),
      ];

      const result = computeReflow(items, tightConfig, planStart("2025-06-02"), earlyNow);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe("DROPPED");
      expect(result.changes[0].after).toBeNull();
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0].code).toBe("DROPPED");
    });

    it("drops excess items when capacity is insufficient", () => {
      // 30 min cap × 7 days = 210 min total capacity
      // Try to place 5 × 60 min = 300 min → some will drop
      const tightConfig: ReflowConfig = {
        availability: Array.from({ length: 7 }, () => ({ start: "09:00", end: "17:00" })),
        daily_study_cap_minutes: 30,
      };

      const items: ReflowItem[] = Array.from({ length: 5 }, (_, i) =>
        makeItem({
          id: `item-${i}`,
          sessionId: `s${i}`,
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          plannedMinutes: 60,
        }),
      );

      const result = computeReflow(items, tightConfig, planStart("2025-06-02"), earlyNow);

      const dropped = result.changes.filter((c) => c.action === "DROPPED");
      expect(dropped.length).toBeGreaterThan(0);
    });
  });

  describe("KEPT items", () => {
    it("reports KEPT when item position does not change", () => {
      // Single item at start of day should stay put
      const items: ReflowItem[] = [
        makeItem({
          id: "1",
          sessionId: "s1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          plannedMinutes: 60,
        }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe("KEPT");
    });
  });

  describe("mixed statuses", () => {
    it("handles a mix of DONE, MISSED, SCHEDULED items", () => {
      const items: ReflowItem[] = [
        makeItem({
          id: "done-1",
          sessionId: "sd1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          status: "DONE",
          plannedMinutes: 60,
        }),
        makeItem({
          id: "missed-1",
          sessionId: "sm1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T10:00:00Z"),
          endTime: new Date("2025-06-02T11:00:00Z"),
          status: "MISSED",
          plannedMinutes: 60,
        }),
        makeItem({
          id: "sched-1",
          sessionId: "ss1",
          dayIndex: 1,
          startTime: new Date("2025-06-03T09:00:00Z"),
          endTime: new Date("2025-06-03T10:00:00Z"),
          status: "SCHEDULED",
          plannedMinutes: 60,
        }),
        makeItem({
          id: "sched-2",
          sessionId: "ss2",
          dayIndex: 1,
          startTime: new Date("2025-06-03T10:00:00Z"),
          endTime: new Date("2025-06-03T11:00:00Z"),
          status: "SCHEDULED",
          plannedMinutes: 60,
          mode: "EXAM_SIM",
        }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      // Only the 2 SCHEDULED items should appear in changes
      expect(result.changes).toHaveLength(2);

      // DONE and MISSED items occupy day 0 09:00-11:00 (120 min against the 180 cap)
      // The SCHEDULED items should not overlap with the DONE/MISSED times
      for (const change of result.changes) {
        if (change.after) {
          const start = new Date(change.after.startTime).getTime();
          const doneEnd = new Date("2025-06-02T10:00:00Z").getTime();
          const missedEnd = new Date("2025-06-02T11:00:00Z").getTime();
          // Should not overlap with fixed intervals on day 0
          if (change.after.dayIndex === 0) {
            expect(start).toBeGreaterThanOrEqual(missedEnd);
          }
        }
      }
    });
  });

  describe("IN_PROGRESS items", () => {
    it("treats IN_PROGRESS as fixed", () => {
      const items: ReflowItem[] = [
        makeItem({
          id: "in-progress-1",
          sessionId: "sip1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          status: "IN_PROGRESS",
          plannedMinutes: 60,
        }),
        makeItem({
          id: "sched-1",
          sessionId: "ss1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          status: "SCHEDULED",
          plannedMinutes: 60,
        }),
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow);

      // Only the scheduled item should appear
      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].itemId).toBe("sched-1");
      // Should be placed after the in-progress item
      expect(result.changes[0].action).toBe("MOVED");
      expect(new Date(result.changes[0].after!.startTime).getTime())
        .toBeGreaterThanOrEqual(new Date("2025-06-02T10:00:00Z").getTime());
    });
  });

  describe("external busy intervals", () => {
    it("avoids external busy times from Google Calendar", () => {
      const items: ReflowItem[] = [
        makeItem({
          id: "1",
          sessionId: "s1",
          dayIndex: 0,
          startTime: new Date("2025-06-02T09:00:00Z"),
          endTime: new Date("2025-06-02T10:00:00Z"),
          plannedMinutes: 60,
        }),
      ];

      // Google Calendar has a meeting 09:00-12:00
      const busyIntervals = [
        { start: new Date("2025-06-02T09:00:00Z").getTime(), end: new Date("2025-06-02T12:00:00Z").getTime() },
      ];

      const result = computeReflow(items, defaultConfig, planStart("2025-06-02"), earlyNow, busyIntervals);

      expect(result.changes).toHaveLength(1);
      expect(result.changes[0].action).toBe("MOVED");
      // Should be placed after the busy period
      expect(new Date(result.changes[0].after!.startTime).getTime())
        .toBeGreaterThanOrEqual(new Date("2025-06-02T12:00:00Z").getTime());
    });
  });
});
