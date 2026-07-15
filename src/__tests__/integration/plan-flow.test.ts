/**
 * Integration tests for the Week Planner flow.
 *
 * Tests: createPlan → getPlan → generatePlanIcs → plan-to-run continuity.
 *
 * Requires a running PostgreSQL database. Set DATABASE_URL before running.
 * Run: DATABASE_URL=<test_db_url> npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let createPlan: any;
let getPlan: any;
let generatePlanIcs: any;
let startOrResumeRun: any;
let submitAttempt: any;
let getRun: any;

describe.skipIf(!hasDb)("Integration: plan creation and retrieval", () => {
  const userId = "test_user_plan";
  let planId: string;
  let itemCount: number;
  let firstSessionId: string;

  // Exam date must be in the future for schedule-intelligence taper logic
  const futureExam = new Date();
  futureExam.setDate(futureExam.getDate() + 30);
  const examDateStr = futureExam.toISOString().split("T")[0];

  const planInput = {
    course_name: "PLAN 201",
    exam_name: "Midterm",
    exam_date: examDateStr,
    objectives: [
      "Data structures",
      "Algorithms",
      "Graph theory",
      "Dynamic programming",
      "Sorting algorithms",
    ],
    availability: Array.from({ length: 7 }, () => ({
      start: "09:00",
      end: "17:00",
    })),
    daily_study_cap_minutes: 180,
    break_protocol_default: "50_10",
  };

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;
    getPlan = planService.getPlan;
    generatePlanIcs = planService.generatePlanIcs;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
    getRun = runService.getRun;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Clean up test data in correct order
    await prisma.studyPlanItem.deleteMany({
      where: { plan: { userId } },
    });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  // ---- Plan creation ----

  it("creates a plan with sessions and items", async () => {
    const result = await createPlan(userId, planInput);

    expect(result.plan_id).toBeDefined();
    expect(result.plan_id.length).toBe(21);
    expect(result.items.length).toBeGreaterThanOrEqual(5);

    planId = result.plan_id;
    itemCount = result.items.length;
    firstSessionId = result.items[0].session_id;

    // Verify each item has required fields
    for (const item of result.items) {
      expect(item.session_id).toBeDefined();
      expect(item.session_url).toContain(`/s/${item.session_id}`);
      expect(item.day_index).toBeGreaterThanOrEqual(0);
      expect(item.day_index).toBeLessThanOrEqual(6);
      expect(item.planned_minutes).toBeGreaterThanOrEqual(15);
      expect(item.mode).toBeDefined();
      expect(item.calendar.title).toContain("PLAN 201");
      expect(item.calendar.description).toBeDefined();
    }
  });

  it("created StudyPlan record in DB", async () => {
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: true },
    });

    expect(plan).not.toBeNull();
    expect(plan.userId).toBe(userId);
    expect(plan.courseName).toBe("PLAN 201");
    expect(plan.examName).toBe("Midterm");
    expect(plan.timezone).toBe("America/New_York");
    expect(plan.items).toHaveLength(itemCount);
  });

  it("created Session records for every plan item", async () => {
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: true },
    });

    for (const item of plan!.items) {
      const session = await prisma.session.findUnique({
        where: { sessionId: item.sessionId },
      });
      expect(session, `Session for item ${item.sessionId} missing`).not.toBeNull();
      expect(session.userId).toBe(userId);
      expect(session.targetOutcome).not.toBeNull();
      expect(session.breakProtocol).not.toBeNull();
    }
  });

  it("plan items have no overlapping times within a day", async () => {
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: { orderBy: [{ dayIndex: "asc" }, { startTime: "asc" }] } },
    });

    const byDay: Record<number, typeof plan.items> = {};
    for (const item of plan!.items) {
      (byDay[item.dayIndex] = byDay[item.dayIndex] || []).push(item);
    }

    for (const [day, dayItems] of Object.entries(byDay)) {
      for (let i = 1; i < dayItems.length; i++) {
        const prev = dayItems[i - 1];
        const curr = dayItems[i];
        expect(
          curr.startTime.getTime() >= prev.endTime.getTime(),
          `Day ${day}: item ${i} starts before item ${i - 1} ends`
        ).toBe(true);
      }
    }
  });

  // ---- Plan retrieval ----

  it("getPlan returns correct data", async () => {
    const result = await getPlan(userId, planId);
    expect("data" in result).toBe(true);
    expect(result.data.plan_id).toBe(planId);
    expect(result.data.items).toHaveLength(itemCount);
    expect(result.data.course_name).toBe("PLAN 201");
    expect(result.data.timezone).toBe("America/New_York");
  });

  it("getPlan returns not_found for unknown plan_id", async () => {
    const result = await getPlan(userId, "nonexistent_plan");
    expect("error" in result).toBe(true);
    expect(result.error).toBe("not_found");
  });

  it("getPlan returns forbidden for other user", async () => {
    const result = await getPlan("other_user", planId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  // ---- ICS export ----

  it("generatePlanIcs returns valid ICS with correct event count", async () => {
    const result = await generatePlanIcs(userId, planId);
    expect("data" in result).toBe(true);

    const ics = result.data as string;
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");

    const eventCount = (ics.match(/BEGIN:VEVENT/g) || []).length;
    expect(eventCount).toBe(itemCount);
  });

  it("ICS events contain session deep links", async () => {
    const result = await generatePlanIcs(userId, planId);
    const ics = result.data as string;

    // Should contain /s/ paths for session deep links
    expect(ics).toContain("/s/");
  });

  it("ICS has no duplicate UIDs", async () => {
    const result = await generatePlanIcs(userId, planId);
    const ics = result.data as string;

    const uidMatches = ics.match(/UID:.+/g) || [];
    const uids = uidMatches.map((m) => m.replace("UID:", "").trim());
    expect(new Set(uids).size).toBe(uids.length);
  });

  it("ICS export returns not_found for unknown plan", async () => {
    const result = await generatePlanIcs(userId, "nonexistent_plan");
    expect("error" in result).toBe(true);
    expect(result.error).toBe("not_found");
  });

  // ---- Plan → Run continuity ----

  it("can start a run on a plan-created session", async () => {
    const result = await startOrResumeRun(userId, firstSessionId);
    expect("data" in result).toBe(true);
    expect(result.data.status).toBe("ACTIVE");
    expect(result.data.prompts.length).toBeGreaterThan(0);
  });

  it("can submit an attempt on a plan-created session run", async () => {
    const runResult = await startOrResumeRun(userId, firstSessionId);
    const runId = runResult.data.run_id;

    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      user_answer: "Data structures include arrays, linked lists, and trees",
      self_score: "CORRECT",
      time_to_answer_seconds: 45,
    });

    expect("data" in result).toBe(true);
    expect(result.data.current_index).toBe(1);
    expect(result.data.metrics.correct_count).toBe(1);
  });

  it("resume after attempt preserves state", async () => {
    const result = await startOrResumeRun(userId, firstSessionId);
    expect("data" in result).toBe(true);
    expect(result.data.resumed).toBe(true);
    expect(result.data.current_index).toBe(1);
    expect(result.data.metrics.attempts_count).toBe(1);
  });
});

describe.skipIf(!hasDb)("Integration: plan ownership enforcement", () => {
  const userId = "test_user_plan_owner";
  let planId: string;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;
    getPlan = planService.getPlan;
    generatePlanIcs = planService.generatePlanIcs;

    const result = await createPlan(userId, {
      course_name: "OWN 101",
      exam_name: "Quiz",
      exam_date: "2025-08-01",
      objectives: ["A", "B", "C"],
      availability: Array.from({ length: 7 }, () => ({
        start: "09:00",
        end: "17:00",
      })),
    });
    planId = result.plan_id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.studyPlanItem.deleteMany({ where: { plan: { userId } } });
    await prisma.studyPlan.deleteMany({ where: { userId } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  it("other user cannot view plan", async () => {
    const result = await getPlan("intruder", planId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  it("other user cannot export plan ICS", async () => {
    const result = await generatePlanIcs("intruder", planId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });
});
