import { describe, it, expect } from "vitest";
import {
  RUN_UNDER_WAY_STATUSES,
  classifyPlanItem,
  countPlanItems,
  runStateFromStatuses,
  withRunUnderWay,
} from "@/lib/plan-status";
import { dateColumnKey, dateColumnValue } from "@/lib/plan-dates";

const NOW = new Date("2026-10-15T20:00:00Z"); // 4:00 PM in New York
const NY = "America/New_York";

describe("runStateFromStatuses", () => {
  it("prefers a completed run, then an active or paused one", () => {
    expect(runStateFromStatuses([])).toBe("none");
    expect(runStateFromStatuses(["CREATED"])).toBe("none");
    expect(runStateFromStatuses(["PAUSED"])).toBe("in_progress");
    expect(runStateFromStatuses(["ACTIVE", "COMPLETED"])).toBe("completed");
  });
});

describe("withRunUnderWay", () => {
  const underWay = new Set(["s1"]);

  it("reads a session with a run under way as IN_PROGRESS, whatever the item stored", () => {
    for (const status of ["SCHEDULED", "RESCHEDULED", "MISSED", "SKIPPED", "IN_PROGRESS"]) {
      expect(withRunUnderWay({ sessionId: "s1", status }, underWay).status).toBe("IN_PROGRESS");
    }
  });

  it("leaves done sessions and sessions without a run as they are", () => {
    const done = { sessionId: "s1", status: "DONE" };
    const other = { sessionId: "s2", status: "SCHEDULED" };
    expect(withRunUnderWay(done, underWay)).toBe(done);
    expect(withRunUnderWay(other, underWay)).toBe(other);
  });

  it("counts the same run statuses as under way that Plan counts as in progress", () => {
    for (const status of RUN_UNDER_WAY_STATUSES) expect(runStateFromStatuses([status])).toBe("in_progress");
  });
});

describe("classifyPlanItem", () => {
  const future = { status: "SCHEDULED", endTime: "2026-10-16T21:00:00Z" };
  const earlierToday = { status: "SCHEDULED", endTime: "2026-10-15T18:40:00Z" }; // 2:40 PM NY
  const yesterday = { status: "SCHEDULED", endTime: "2026-10-14T20:30:00Z" };

  it("reads stored terminal statuses first", () => {
    expect(classifyPlanItem({ ...future, status: "SKIPPED" }, "none", NOW)).toBe("skipped");
    expect(classifyPlanItem({ ...future, status: "DONE" }, "none", NOW)).toBe("done");
    expect(classifyPlanItem({ ...future, status: "MISSED" }, "none", NOW)).toBe("missed");
  });

  it("counts a completed run as done even when the item was rescheduled", () => {
    expect(classifyPlanItem({ ...future, status: "RESCHEDULED" }, "completed", NOW)).toBe("done");
  });

  it("lets a skipped session's runs win: finished from its link, it reads done", () => {
    expect(classifyPlanItem({ ...future, status: "SKIPPED" }, "completed", NOW)).toBe("done");
    expect(classifyPlanItem({ ...future, status: "SKIPPED" }, "in_progress", NOW)).toBe("in_progress");
  });

  it("marks a started session as in progress", () => {
    expect(classifyPlanItem(yesterday, "in_progress", NOW)).toBe("in_progress");
  });

  it("keeps future sessions scheduled and past unstarted ones missed", () => {
    expect(classifyPlanItem(future, "none", NOW)).toBe("scheduled");
    expect(classifyPlanItem(yesterday, "none", NOW, NY)).toBe("missed");
  });

  it("keeps today's unstarted session open until the day ends in the zone", () => {
    expect(classifyPlanItem(earlierToday, "none", NOW, NY)).toBe("scheduled");
    // Without a zone only the time counts
    expect(classifyPlanItem(earlierToday, "none", NOW)).toBe("missed");
  });
});

describe("countPlanItems", () => {
  it("counts each state and leaves skipped out of the total", () => {
    expect(countPlanItems(["done", "done", "missed", "scheduled", "skipped", "in_progress"])).toEqual({
      total: 5,
      done: 2,
      in_progress: 1,
      missed: 1,
      scheduled: 1,
      skipped: 1,
    });
  });
});

describe("DATE columns", () => {
  it("reads the stored calendar day, not the evening before in a zone west of UTC", () => {
    // Prisma returns a DATE as midnight UTC
    const stored = new Date("2026-10-15T00:00:00.000Z");
    expect(dateColumnKey(stored)).toBe("2026-10-15");
  });

  it("writes the calendar day itself", () => {
    expect(dateColumnValue("2026-10-15").toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(() => dateColumnValue("Oct 15")).toThrow();
  });
});
