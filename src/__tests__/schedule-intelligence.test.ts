import { describe, it, expect } from "vitest";
import {
  scoreSlot,
  applyPreExamTaper,
  adjustDurationByMode,
  fitBlocksScored,
  estimateBedtime,
  findIntradaySpacingViolations,
  isClassEvent,
  isRelatedClass,
  MAX_DURATION_BY_MODE,
  type CalendarEvent,
} from "@/lib/schedule-intelligence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSlot(hour: number, durationMin: number = 60) {
  const d = new Date(2026, 3, 10); // April 10, 2026
  d.setHours(hour, 0, 0, 0);
  return {
    start: d.getTime(),
    end: d.getTime() + durationMin * 60 * 1000,
  };
}

function makeEvent(summary: string, hour: number, durationMin: number): CalendarEvent {
  const d = new Date(2026, 3, 10);
  d.setHours(hour, 0, 0, 0);
  return {
    summary,
    start: d.getTime(),
    end: d.getTime() + durationMin * 60 * 1000,
  };
}

// ---------------------------------------------------------------------------
// scoreSlot
// ---------------------------------------------------------------------------

describe("scoreSlot", () => {
  it("scores RETRIEVAL higher at morning peak for morning chronotype", () => {
    const morningScore = scoreSlot({
      slot: makeSlot(9),
      mode: "RETRIEVAL",
      chronotype: "morning",
      dayEvents: [],
      bedtimeHour: 23,
    });
    const eveningScore = scoreSlot({
      slot: makeSlot(20),
      mode: "RETRIEVAL",
      chronotype: "morning",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(morningScore).toBeGreaterThan(eveningScore);
  });

  it("scores RETRIEVAL higher at evening peak for evening chronotype", () => {
    const morningScore = scoreSlot({
      slot: makeSlot(8),
      mode: "RETRIEVAL",
      chronotype: "evening",
      dayEvents: [],
      bedtimeHour: 1,
    });
    const eveningScore = scoreSlot({
      slot: makeSlot(18),
      mode: "RETRIEVAL",
      chronotype: "evening",
      dayEvents: [],
      bedtimeHour: 1,
    });
    expect(eveningScore).toBeGreaterThan(morningScore);
  });

  it("gives INTERLEAVED_PRACTICE good scores at off-peak times", () => {
    const offPeakScore = scoreSlot({
      slot: makeSlot(15),
      mode: "INTERLEAVED_PRACTICE",
      chronotype: "morning",
      dayEvents: [],
      bedtimeHour: 23,
    });
    // Off-peak should still be viable for low-load modes
    expect(offPeakScore).toBeGreaterThan(0.3);
  });

  it("boosts score after exercise events", () => {
    const exerciseEvent = makeEvent("Gym workout", 8, 60);

    const withExercise = scoreSlot({
      slot: makeSlot(9, 60), // 1 hour after gym starts, 0 min after it ends
      mode: "RETRIEVAL",
      chronotype: "morning",
      dayEvents: [exerciseEvent],
      bedtimeHour: 23,
    });
    const withoutExercise = scoreSlot({
      slot: makeSlot(9, 60),
      mode: "RETRIEVAL",
      chronotype: "morning",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(withExercise).toBeGreaterThan(withoutExercise);
  });

  it("reduces score after heavy meeting load (fatigue)", () => {
    const meetings = [
      makeEvent("Team meeting", 8, 60),
      makeEvent("Planning session", 9, 90),
      makeEvent("Review meeting", 11, 60),
    ];

    const afterMeetings = scoreSlot({
      slot: makeSlot(13),
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: meetings,
      bedtimeHour: 23,
    });
    const noMeetings = scoreSlot({
      slot: makeSlot(13),
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(afterMeetings).toBeLessThan(noMeetings);
  });

  it("gives ERROR_REPAIR sleep proximity bonus near bedtime", () => {
    const nearBed = scoreSlot({
      slot: makeSlot(21),
      mode: "ERROR_REPAIR",
      chronotype: "flexible",
      dayEvents: [],
      bedtimeHour: 23,
    });
    const farFromBed = scoreSlot({
      slot: makeSlot(10),
      mode: "ERROR_REPAIR",
      chronotype: "flexible",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(nearBed).toBeGreaterThan(farFromBed);
  });

  it("returns score in [0, 1] range", () => {
    const score = scoreSlot({
      slot: makeSlot(14),
      mode: "EXAM_SIM",
      chronotype: "flexible",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// applyPreExamTaper
// ---------------------------------------------------------------------------

describe("applyPreExamTaper", () => {
  const planStart = new Date(2026, 3, 7); // April 7

  it("removes blocks on exam day", () => {
    const examDate = new Date(2026, 3, 10); // April 10
    const blocks = [
      { dayIndex: 0, mode: "RETRIEVAL", plannedMinutes: 60 },
      { dayIndex: 3, mode: "RETRIEVAL", plannedMinutes: 60 }, // exam day
    ];
    const result = applyPreExamTaper(blocks, examDate, planStart);
    expect(result).toHaveLength(1);
    expect(result[0].dayIndex).toBe(0);
  });

  it("limits final 24h to one short RETRIEVAL session", () => {
    const examDate = new Date(2026, 3, 10);
    const blocks = [
      { dayIndex: 2, mode: "EXAM_SIM", plannedMinutes: 60 },
      { dayIndex: 2, mode: "ERROR_REPAIR", plannedMinutes: 45 },
    ];
    const result = applyPreExamTaper(blocks, examDate, planStart);
    // Only 1 block kept, shifted to RETRIEVAL, capped at 25 min
    expect(result).toHaveLength(1);
    expect(result[0].mode).toBe("RETRIEVAL");
    expect(result[0].plannedMinutes).toBeLessThanOrEqual(25);
  });

  it("reduces volume by ~40% in the 24-48h window", () => {
    const examDate = new Date(2026, 3, 10);
    const blocks = [
      { dayIndex: 1, mode: "INTERLEAVED_PRACTICE", plannedMinutes: 100 },
    ];
    const result = applyPreExamTaper(blocks, examDate, planStart);
    expect(result).toHaveLength(1);
    expect(result[0].mode).toBe("RETRIEVAL");
    expect(result[0].plannedMinutes).toBe(60); // 100 * 0.6
  });

  it("does not modify blocks far from exam", () => {
    const examDate = new Date(2026, 3, 14); // 7 days out
    const blocks = [
      { dayIndex: 0, mode: "EXAM_SIM", plannedMinutes: 60 },
    ];
    const result = applyPreExamTaper(blocks, examDate, planStart);
    expect(result[0].mode).toBe("EXAM_SIM");
    expect(result[0].plannedMinutes).toBe(60);
  });

  it("keeps the day-before-exam block when the plan is created late in the day", () => {
    const examDate = new Date(2026, 3, 10); // April 10
    const eveningStart = new Date(2026, 3, 7, 20, 0); // April 7, 20:00 local
    const blocks = [
      { dayIndex: 0, mode: "RETRIEVAL", plannedMinutes: 60 },
      { dayIndex: 2, mode: "EXAM_SIM", plannedMinutes: 60 }, // April 9, day before exam
    ];
    const result = applyPreExamTaper(blocks, examDate, eveningStart);
    // Before normalizing plan start to local midnight, the day-before-exam
    // block's assumed midday landed AFTER exam midnight and was deleted
    expect(result).toHaveLength(2);
    const dayBefore = result.find((b) => b.dayIndex === 2);
    expect(dayBefore).toBeDefined();
    expect(dayBefore!.mode).toBe("RETRIEVAL"); // final 24h → short retrieval
    expect(dayBefore!.plannedMinutes).toBeLessThanOrEqual(25);
  });

  it("classifies taper windows identically for midnight and late-evening plan creation", () => {
    const examDate = new Date(2026, 3, 10); // April 10
    const midnightStart = new Date(2026, 3, 7); // April 7, 00:00
    const eveningStart = new Date(2026, 3, 7, 20, 0); // April 7, 20:00
    const blocks = [
      { dayIndex: 0, mode: "EXAM_SIM", plannedMinutes: 60 },              // normal
      { dayIndex: 1, mode: "INTERLEAVED_PRACTICE", plannedMinutes: 100 }, // 48h window
      { dayIndex: 2, mode: "ERROR_REPAIR", plannedMinutes: 45 },          // 24h window
      { dayIndex: 3, mode: "RETRIEVAL", plannedMinutes: 60 },             // exam day
    ];
    const fromMidnight = applyPreExamTaper(blocks, examDate, midnightStart);
    const fromEvening = applyPreExamTaper(blocks, examDate, eveningStart);
    expect(fromEvening).toEqual(fromMidnight);
    // Sanity-check the midnight classification both plans must share
    expect(fromMidnight).toHaveLength(3);
    expect(fromMidnight[0].mode).toBe("EXAM_SIM"); // >48h out — untouched
    expect(fromMidnight[1].mode).toBe("RETRIEVAL");
    expect(fromMidnight[1].plannedMinutes).toBe(60); // 100 * 0.6
    expect(fromMidnight[2].mode).toBe("RETRIEVAL");
    expect(fromMidnight[2].plannedMinutes).toBe(25);
  });

  it("drops exam-day blocks regardless of the exam's time of day", () => {
    const examDate = new Date(2026, 3, 10, 9, 0); // April 10, 09:00 exam
    const blocks = [
      { dayIndex: 2, mode: "ERROR_REPAIR", plannedMinutes: 45 }, // April 9
      { dayIndex: 3, mode: "RETRIEVAL", plannedMinutes: 60 },    // April 10, exam day
    ];
    const result = applyPreExamTaper(blocks, examDate, planStart);
    expect(result).toHaveLength(1);
    expect(result[0].dayIndex).toBe(2);
    expect(result[0].mode).toBe("RETRIEVAL");
  });
});

// ---------------------------------------------------------------------------
// adjustDurationByMode
// ---------------------------------------------------------------------------

describe("adjustDurationByMode", () => {
  it("caps EXAM_SIM at 50 minutes", () => {
    expect(adjustDurationByMode(90, "EXAM_SIM")).toBe(MAX_DURATION_BY_MODE.EXAM_SIM);
  });

  it("caps RETRIEVAL at 45 minutes", () => {
    expect(adjustDurationByMode(80, "RETRIEVAL")).toBe(MAX_DURATION_BY_MODE.RETRIEVAL);
  });

  it("allows INTERLEAVED_PRACTICE up to 60 minutes", () => {
    expect(adjustDurationByMode(55, "INTERLEAVED_PRACTICE")).toBe(55);
    expect(adjustDurationByMode(90, "INTERLEAVED_PRACTICE")).toBe(60);
  });

  it("never goes below 15 minutes", () => {
    expect(adjustDurationByMode(10, "RETRIEVAL")).toBe(15);
  });

  it("passes through unknown modes unchanged", () => {
    expect(adjustDurationByMode(120, "CUSTOM_MODE")).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// fitBlocksScored
// ---------------------------------------------------------------------------

describe("fitBlocksScored", () => {
  it("places high-load modes in better-scoring slots", () => {
    const slots = [
      makeSlot(9, 60),  // morning (peak for morning type)
      makeSlot(15, 60), // afternoon (off-peak)
    ];

    const result = fitBlocksScored({
      blockDurationsMs: [45 * 60000, 45 * 60000],
      blockModes: ["RETRIEVAL", "INTERLEAVED_PRACTICE"],
      freeSlots: slots,
      chronotype: "morning",
      dayEvents: [],
      bedtimeHour: 23,
    });

    // RETRIEVAL should get the morning slot (higher circadian score)
    expect(result[0]).not.toBeNull();
    expect(result[1]).not.toBeNull();
    // RETRIEVAL (index 0) should be in morning slot
    expect(new Date(result[0]!.start).getHours()).toBe(9);
  });

  it("returns null for blocks that do not fit", () => {
    const result = fitBlocksScored({
      blockDurationsMs: [120 * 60000],
      blockModes: ["RETRIEVAL"],
      freeSlots: [makeSlot(9, 30)], // only 30 min available
      chronotype: "flexible",
      dayEvents: [],
      bedtimeHour: 23,
    });
    expect(result[0]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// estimateBedtime
// ---------------------------------------------------------------------------

describe("estimateBedtime", () => {
  it("defaults to 23 with no events", () => {
    expect(estimateBedtime([])).toBe(23);
  });

  it("estimates bedtime from latest event", () => {
    const events = [
      makeEvent("Dinner", 18, 60),
      makeEvent("Evening class", 20, 120), // ends at 22:00
    ];
    // 22 + 2 = 24 → 0 → default 23
    const bedtime = estimateBedtime(events);
    expect(bedtime).toBeGreaterThanOrEqual(22);
    expect(bedtime).toBeLessThanOrEqual(24);
  });
});

// ---------------------------------------------------------------------------
// findIntradaySpacingViolations
// ---------------------------------------------------------------------------

describe("findIntradaySpacingViolations", () => {
  it("detects same-topic sessions within 1 hour on same day", () => {
    const blocks = [
      { dayIndex: 0, topicScope: "Linear Algebra, Matrices", startMinuteOfDay: 540 },
      { dayIndex: 0, topicScope: "Matrices, Determinants", startMinuteOfDay: 570 },  // 30 min gap
    ];
    const violations = findIntradaySpacingViolations(blocks, 60);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("allows same-topic sessions with sufficient gap", () => {
    const blocks = [
      { dayIndex: 0, topicScope: "Linear Algebra", startMinuteOfDay: 540 },
      { dayIndex: 0, topicScope: "Linear Algebra", startMinuteOfDay: 660 }, // 2h gap
    ];
    const violations = findIntradaySpacingViolations(blocks, 60);
    expect(violations).toHaveLength(0);
  });

  it("ignores different topics on the same day", () => {
    const blocks = [
      { dayIndex: 0, topicScope: "Calculus", startMinuteOfDay: 540 },
      { dayIndex: 0, topicScope: "Chemistry", startMinuteOfDay: 570 },
    ];
    const violations = findIntradaySpacingViolations(blocks, 60);
    expect(violations).toHaveLength(0);
  });

  it("ignores same-topic sessions on different days", () => {
    const blocks = [
      { dayIndex: 0, topicScope: "Linear Algebra", startMinuteOfDay: 540 },
      { dayIndex: 1, topicScope: "Linear Algebra", startMinuteOfDay: 540 },
    ];
    const violations = findIntradaySpacingViolations(blocks, 60);
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// isClassEvent
// ---------------------------------------------------------------------------

describe("isClassEvent", () => {
  it("detects events with class keywords", () => {
    expect(isClassEvent("Organic Chemistry Lecture")).toBe(true);
    expect(isClassEvent("Math discussion section")).toBe(true);
    expect(isClassEvent("Physics lab")).toBe(true);
    expect(isClassEvent("CS 101 recitation")).toBe(true);
  });

  it("detects course code patterns", () => {
    expect(isClassEvent("CS 101")).toBe(true);
    expect(isClassEvent("MATH 240")).toBe(true);
    expect(isClassEvent("PHYS 2A")).toBe(true);
    expect(isClassEvent("BIO 101L")).toBe(true);
    expect(isClassEvent("EE 120")).toBe(true);
  });

  it("does not match non-class events", () => {
    expect(isClassEvent("Gym workout")).toBe(false);
    expect(isClassEvent("Dinner with friends")).toBe(false);
    expect(isClassEvent("Doctor appointment")).toBe(false);
    expect(isClassEvent("Team standup")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRelatedClass
// ---------------------------------------------------------------------------

describe("isRelatedClass", () => {
  it("matches exact course name in event summary", () => {
    expect(isRelatedClass("CS 101 Lecture", "CS 101")).toBe(true);
  });

  it("matches partial course name words", () => {
    expect(isRelatedClass("Organic Chemistry Lab", "Organic Chemistry")).toBe(true);
  });

  it("matches topic scope keywords", () => {
    expect(isRelatedClass(
      "Linear Algebra Discussion",
      undefined,
      "Linear Algebra, Matrices, Determinants",
    )).toBe(true);
  });

  it("does not match unrelated classes", () => {
    expect(isRelatedClass("Biology 101 Lecture", "CS 101")).toBe(false);
  });

  it("does not match with no course/topic info", () => {
    expect(isRelatedClass("CS 101", undefined, undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Post-class timing in scoreSlot
// ---------------------------------------------------------------------------

describe("post-class timing", () => {
  it("penalizes same-subject study immediately after class", () => {
    // Class ends at 10:00, study slot at 10:15 (15 min gap)
    const classEvent = makeEvent("CS 101 Lecture", 9, 60);

    const immediateScore = scoreSlot({
      slot: makeSlot(10, 45), // 10:00-10:45, right after class
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "CS 101",
      topicScope: "Data Structures",
    });

    const delayedScore = scoreSlot({
      slot: makeSlot(12, 45), // 12:00-12:45, 2 hours after class
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "CS 101",
      topicScope: "Data Structures",
    });

    // Delayed slot should score much better than immediate
    expect(delayedScore).toBeGreaterThan(immediateScore);
  });

  it("gives optimal score to 1-2 hour post-class window", () => {
    const classEvent = makeEvent("MATH 240 Lecture", 9, 60);

    const optimalWindow = scoreSlot({
      slot: makeSlot(11, 45), // 1.5 hours after class ends at 10
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "MATH 240",
    });

    const tooSoon = scoreSlot({
      slot: makeSlot(10, 45), // 0 hours after class
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "MATH 240",
    });

    expect(optimalWindow).toBeGreaterThan(tooSoon);
  });

  it("allows different-subject study right after class", () => {
    const classEvent = makeEvent("Biology 101 Lecture", 9, 60);

    const differentSubject = scoreSlot({
      slot: makeSlot(10, 45), // right after bio class
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "CS 101", // different course
      topicScope: "Data Structures",
    });

    const sameSubject = scoreSlot({
      slot: makeSlot(10, 45),
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [classEvent],
      bedtimeHour: 23,
      courseName: "Biology 101", // same course
      topicScope: "Cell Biology",
    });

    // Different subject should score better than same subject right after class
    expect(differentSubject).toBeGreaterThan(sameSubject);
  });

  it("handles no class events gracefully (neutral score)", () => {
    const score = scoreSlot({
      slot: makeSlot(10, 45),
      mode: "RETRIEVAL",
      chronotype: "flexible",
      dayEvents: [], // no events
      bedtimeHour: 23,
      courseName: "CS 101",
    });
    // Should produce a reasonable score (not penalized)
    expect(score).toBeGreaterThan(0.3);
  });
});
