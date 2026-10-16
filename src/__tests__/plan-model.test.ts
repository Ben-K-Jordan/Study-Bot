import { describe, it, expect } from "vitest";
import {
  buildAgenda,
  canReschedule,
  examCountdown,
  examRelative,
  formatDayKey,
  keyOf,
  modeLabel,
  previewSentence,
  rescheduleToast,
  samePlanTarget,
  sortPlans,
} from "@/components/plan/plan-model";
import type { PlanViewItem } from "@/services/plan";

const NY = "America/New_York";
const NOW = new Date("2026-10-15T20:00:00Z"); // Thu Oct 15, 4:00 PM New York

function item(id: string, start: string, minutes: number, state: PlanViewItem["state"]): PlanViewItem {
  const startMs = Date.parse(start);
  return {
    id,
    session_id: `s-${id}`,
    start_time: new Date(startMs).toISOString(),
    end_time: new Date(startMs + minutes * 60_000).toISOString(),
    state,
    status: "SCHEDULED",
    locked: false,
    mode: "RETRIEVAL",
    topics: [],
    planned_minutes: minutes,
    original_start_time: null,
  };
}

describe("buildAgenda", () => {
  it("groups by the day in the zone and places the exam day in date order", () => {
    const agenda = buildAgenda(
      {
        exam_date: "2026-10-18",
        items: [
          // 11:30 PM New York on the 16th is the 17th in UTC: it belongs to the 16th
          item("late", "2026-10-17T03:30:00Z", 30, "scheduled"),
          item("after", "2026-10-20T20:00:00Z", 30, "scheduled"),
          item("today", "2026-10-15T22:00:00Z", 30, "scheduled"),
        ],
      },
      { timeZone: NY, now: NOW }
    );
    expect(agenda.days.map((d) => d.key)).toEqual(["2026-10-15", "2026-10-16", "2026-10-18", "2026-10-20"]);
    const exam = agenda.days.find((d) => d.isExamDay)!;
    expect(exam.sessions).toHaveLength(0);
    expect(agenda.days[0].isToday).toBe(true);
    expect(agenda.days[0].sessions[0].display).toBe("today");
    expect(agenda.days[3].sessions[0].afterExam).toBe(true);
    expect(agenda.days[1].sessions[0].afterExam).toBe(false);
  });

  it("folds only the leading run of finished past days", () => {
    const agenda = buildAgenda(
      {
        exam_date: "2026-10-22",
        items: [
          item("a", "2026-10-10T20:00:00Z", 30, "done"),
          item("b", "2026-10-11T20:00:00Z", 30, "skipped"),
          item("c", "2026-10-12T20:00:00Z", 30, "missed"),
          item("d", "2026-10-13T20:00:00Z", 30, "done"),
          item("e", "2026-10-16T20:00:00Z", 30, "scheduled"),
        ],
      },
      { timeZone: NY, now: NOW }
    );
    expect(agenda.earlier.map((d) => d.key)).toEqual(["2026-10-10", "2026-10-11"]);
    expect(agenda.days.map((d) => d.key)).toEqual(["2026-10-12", "2026-10-13", "2026-10-16", "2026-10-22"]);
  });

  it("never folds the exam day", () => {
    const agenda = buildAgenda(
      { exam_date: "2026-10-12", items: [item("a", "2026-10-10T20:00:00Z", 30, "done")] },
      { timeZone: NY, now: NOW }
    );
    expect(agenda.earlier.map((d) => d.key)).toEqual(["2026-10-10"]);
    expect(agenda.days.map((d) => d.key)).toEqual(["2026-10-12"]);
  });
});

describe("sortPlans", () => {
  it("lists upcoming exams soonest first, then past exams newest first", () => {
    const plans = [
      { id: "far", exam_date: "2026-12-14", created_at: "2026-10-01T00:00:00Z" },
      { id: "past-old", exam_date: "2026-09-01", created_at: "2026-08-01T00:00:00Z" },
      { id: "today", exam_date: "2026-10-15", created_at: "2026-10-01T00:00:00Z" },
      { id: "past-new", exam_date: "2026-10-10", created_at: "2026-09-01T00:00:00Z" },
      { id: "soon", exam_date: "2026-10-22", created_at: "2026-10-01T00:00:00Z" },
    ];
    expect(sortPlans(plans, { timeZone: NY, now: NOW }).map((p) => p.id)).toEqual([
      "today",
      "soon",
      "far",
      "past-new",
      "past-old",
    ]);
  });
});

describe("plan helpers", () => {
  it("matches a replace target on course and exam, ignoring case and spacing", () => {
    const plan = { course_name: "INFO 1300", exam_name: "Prelim 2" };
    expect(samePlanTarget(plan, { course_name: " info  1300 ", exam_name: "prelim 2" })).toBe(true);
    expect(samePlanTarget(plan, { course_name: "INFO 1300", exam_name: "Final" })).toBe(false);
    expect(samePlanTarget(plan, { course_name: "INFO 4340", exam_name: "Prelim 2" })).toBe(false);
  });

  it("offers rescheduling only before the exam and only with sessions to move", () => {
    const counts = { total: 3, done: 1, in_progress: 0, missed: 1, scheduled: 1, skipped: 0 };
    expect(canReschedule({ exam_date: "2026-10-22", counts }, NY, NOW)).toBe(true);
    expect(canReschedule({ exam_date: "2026-10-15", counts }, NY, NOW)).toBe(false);
    expect(
      canReschedule({ exam_date: "2026-10-22", counts: { ...counts, missed: 0, scheduled: 0 } }, NY, NOW)
    ).toBe(false);
  });

  it("formats calendar-day keys the same in every zone", () => {
    expect(formatDayKey("2026-10-22")).toBe("Thu, Oct 22");
    expect(examCountdown("Prelim 2", "2026-10-22", "2026-10-15")).toBe("Prelim 2 is in 7 days");
    expect(examCountdown("Prelim 2", "2026-10-16", "2026-10-15")).toBe("Prelim 2 is tomorrow");
    expect(examRelative("2026-10-22", "2026-10-15")).toBe("in 7 days");
    expect(examRelative("2026-10-13", "2026-10-15")).toBe("2 days ago");
    expect(keyOf(new Date("2026-10-16T03:30:00Z"), NY)).toBe("2026-10-15");
  });

  it("names modes in sentence case", () => {
    expect(modeLabel("EXAM_SIM")).toBe("Exam simulation");
    expect(modeLabel("INTERLEAVED_PRACTICE")).toBe("Interleaved practice");
    expect(modeLabel("")).toBe("Session");
  });
});

describe("previewSentence", () => {
  it("says what moves, what stays and what will be skipped, with real plurals", () => {
    expect(previewSentence({ moved: 3, kept: 5, dropped: 2 }, "Prelim 1")).toBe(
      "3 sessions move and 5 stay. 2 don't fit before Prelim 1 and will be skipped."
    );
    expect(previewSentence({ moved: 1, kept: 1, dropped: 0 }, "Prelim 1")).toBe("1 session moves and 1 stays.");
    expect(previewSentence({ moved: 0, kept: 0, dropped: 1 }, "Final")).toBe(
      "1 doesn't fit before Final and will be skipped."
    );
  });
});

describe("rescheduleToast", () => {
  const applied = (moved: number, dropped: number, calendar: { status?: string; code?: string } | null = null) => ({
    applied: true,
    summary: { moved, dropped },
    calendar,
  })

  it("says what moved and what was skipped in one message", () => {
    expect(rescheduleToast(applied(3, 2)).title).toBe("3 sessions moved and 2 skipped")
    expect(rescheduleToast(applied(1, 1)).title).toBe("1 session moved and 1 skipped")
    expect(rescheduleToast(applied(2, 0)).title).toBe("2 sessions moved")
    expect(rescheduleToast(applied(0, 1)).title).toBe("1 session skipped")
    expect(rescheduleToast({ applied: false, calendar: null }).title).toBe("Nothing to reschedule")
  })

  it("adds one whole sentence about Google Calendar, with the way to fix it", () => {
    expect(rescheduleToast(applied(3, 0, { status: "OK" }))).toEqual({
      title: "3 sessions moved",
      description: "Google Calendar updated.",
    })
    expect(rescheduleToast(applied(3, 2, { status: "PARTIAL" }))).toEqual({
      title: "3 sessions moved and 2 skipped",
      description: "Some Google Calendar events weren't updated. Update them from the plan menu.",
      calendarAction: "update",
    })
    expect(rescheduleToast(applied(3, 0, { status: "FAILED", code: "unknown" }))).toEqual({
      title: "3 sessions moved",
      description: "Google Calendar wasn't updated. Update it from the plan menu.",
      calendarAction: "update",
    })
    expect(rescheduleToast(applied(3, 0, { status: "FAILED", code: "GOOGLE_RECONNECT_REQUIRED" })).calendarAction).toBe(
      "reconnect"
    )
    expect(rescheduleToast(applied(3, 0, { status: "NOT_PUBLISHED" })).description).toBeUndefined()
  })
})
