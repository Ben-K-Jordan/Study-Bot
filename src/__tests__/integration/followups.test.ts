/**
 * Integration tests for the follow-up scheduler.
 *
 * Tests: scheduleFollowups inserts RETRIEVAL plan items on the active plan,
 * is idempotent per run, and reports "no_plan" when the user has no active
 * study plan.
 *
 * Requires a running PostgreSQL database. Set DATABASE_URL before running.
 * Run: DATABASE_URL=<test_db_url> npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let createPlan: any;
let scheduleFollowups: any;

const userId = "test_user_followups";
const noPlanUserId = "test_user_followups_noplan";

async function cleanup(uid: string) {
  await prisma.studyPlanItem.deleteMany({ where: { plan: { userId: uid } } });
  await prisma.studyPlan.deleteMany({ where: { userId: uid } });
  await prisma.sessionRun.deleteMany({ where: { userId: uid } });
  await prisma.session.deleteMany({ where: { userId: uid } });
}

/** Create a completed RETRIEVAL session + run for the given user/course. */
async function createCompletedRun(
  uid: string,
  courseName: string,
  accuracy: number,
  suffix: string,
) {
  const sessionId = `fu_session_${suffix}`;
  const runId = `fu_run_${suffix}`;
  await prisma.session.create({
    data: {
      sessionId,
      userId: uid,
      courseId: "",
      courseName,
      examId: "",
      examName: "Midterm",
      mode: "RETRIEVAL",
      topicScope: "Data structures, Algorithms",
      objectives: [
        { id: "obj_1", title: "Data structures" },
        { id: "obj_2", title: "Algorithms" },
      ],
      targetOutcome: { type: "accuracy", target_accuracy: 0.8 },
      breakProtocol: { type: "50_10", cycles: 1 },
      plannedMinutes: 30,
    },
  });
  await prisma.sessionRun.create({
    data: {
      runId,
      sessionId,
      userId: uid,
      mode: "RETRIEVAL",
      phase: "COMPLETE",
      status: "COMPLETED",
      startedAt: new Date(Date.now() - 30 * 60 * 1000),
      endedAt: new Date(),
      prompts: [],
      metrics: {
        attempts_count: 8,
        correct_count: 6,
        partial_count: 1,
        incorrect_count: 1,
        accuracy,
        time_spent_seconds: 1200,
      },
    },
  });
  return { sessionId, runId };
}

describe.skipIf(!hasDb)("Integration: follow-up scheduling", () => {
  let planId: string;
  let runId: string;
  let baselineItemCount: number;

  const futureExam = new Date();
  futureExam.setDate(futureExam.getDate() + 30);
  const examDateStr = futureExam.toISOString().split("T")[0];

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const planService = await import("@/services/plan");
    createPlan = planService.createPlan;
    const followupService = await import("@/services/followups");
    scheduleFollowups = followupService.scheduleFollowups;

    await cleanup(userId);
    await cleanup(noPlanUserId);

    const plan = await createPlan(userId, {
      course_name: "FOLLOWUP 301",
      exam_name: "Midterm",
      exam_date: examDateStr,
      objectives: ["Data structures", "Algorithms", "Graph theory"],
      availability: Array.from({ length: 7 }, () => ({
        start: "09:00",
        end: "17:00",
      })),
      daily_study_cap_minutes: 180,
      break_protocol_default: "50_10",
    });
    planId = plan.plan_id;
    baselineItemCount = plan.items.length;

    const run = await createCompletedRun(userId, "FOLLOWUP 301", 0.75, "main");
    runId = run.runId;
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanup(userId);
    await cleanup(noPlanUserId);
    await prisma.$disconnect();
  });

  it("schedules the recommended follow-ups on the active plan", async () => {
    const result = await scheduleFollowups(userId, runId);
    expect("data" in result).toBe(true);
    expect(result.data.status).toBe("scheduled");
    expect(result.data.plan_id).toBe(planId);
    // Accuracy 0.75 -> +2 and +4 days, both well before the exam
    expect(result.data.scheduled).toHaveLength(2);
    expect(result.data.scheduled.map((s: any) => s.days_from_now)).toEqual([2, 4]);
    expect(result.data.skipped).toEqual([]);
    for (const s of result.data.scheduled) {
      expect(s.session_id).toBeDefined();
      expect(s.session_url).toContain(`/s/${s.session_id}`);
      expect(s.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.date <= examDateStr).toBe(true);
    }
  });

  it("created RETRIEVAL sessions carrying the run marker and the objectives", async () => {
    const sessions = await prisma.session.findMany({
      where: {
        userId,
        resources: { path: ["followup_of_run_id"], equals: runId },
      },
    });
    expect(sessions).toHaveLength(2);
    for (const s of sessions) {
      expect(s.mode).toBe("RETRIEVAL");
      expect(s.plannedMinutes).toBe(30);
      expect(s.courseName).toBe("FOLLOWUP 301");
      expect(s.topicScope).toContain("Data structures");
      expect(s.objectives).toEqual([
        { id: "obj_1", title: "Data structures" },
        { id: "obj_2", title: "Algorithms" },
      ]);
    }
  });

  it("created plan items for the follow-up sessions", async () => {
    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: true },
    });
    expect(plan.items).toHaveLength(baselineItemCount + 2);

    const sessions = await prisma.session.findMany({
      where: { userId, resources: { path: ["followup_of_run_id"], equals: runId } },
      select: { sessionId: true },
    });
    for (const s of sessions) {
      const item = plan.items.find((i: any) => i.sessionId === s.sessionId);
      expect(item, `plan item for ${s.sessionId} missing`).toBeDefined();
      expect(item.status).toBe("SCHEDULED");
      expect(item.endTime.getTime() - item.startTime.getTime()).toBe(30 * 60000);
    }
  });

  it("is idempotent: a second call does not double-insert", async () => {
    const result = await scheduleFollowups(userId, runId);
    expect("data" in result).toBe(true);
    expect(result.data.status).toBe("already_scheduled");
    expect(result.data.scheduled).toHaveLength(2);

    const sessions = await prisma.session.findMany({
      where: { userId, resources: { path: ["followup_of_run_id"], equals: runId } },
    });
    expect(sessions).toHaveLength(2);

    const plan = await prisma.studyPlan.findUnique({
      where: { planId },
      include: { items: true },
    });
    expect(plan.items).toHaveLength(baselineItemCount + 2);
  });

  it("returns no_plan when the user has no active study plan", async () => {
    const { runId: orphanRunId } = await createCompletedRun(
      noPlanUserId,
      "NOPLAN 101",
      0.75,
      "noplan",
    );
    const result = await scheduleFollowups(noPlanUserId, orphanRunId);
    expect("data" in result).toBe(true);
    expect(result.data.status).toBe("no_plan");

    // Nothing was inserted
    const sessions = await prisma.session.findMany({
      where: {
        userId: noPlanUserId,
        resources: { path: ["followup_of_run_id"], equals: orphanRunId },
      },
    });
    expect(sessions).toHaveLength(0);
  });

  it("rejects runs owned by another user", async () => {
    const result = await scheduleFollowups("intruder", runId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  it("rejects unknown runs", async () => {
    const result = await scheduleFollowups(userId, "does_not_exist");
    expect("error" in result).toBe(true);
    expect(result.error).toBe("not_found");
  });

  it("rejects runs that are not completed", async () => {
    const sessionId = "fu_session_active";
    const activeRunId = "fu_run_active";
    await prisma.session.create({
      data: {
        sessionId,
        userId,
        courseId: "",
        courseName: "FOLLOWUP 301",
        examId: "",
        examName: "Midterm",
        mode: "RETRIEVAL",
        topicScope: "Graph theory",
        plannedMinutes: 30,
      },
    });
    await prisma.sessionRun.create({
      data: {
        runId: activeRunId,
        sessionId,
        userId,
        mode: "RETRIEVAL",
        status: "ACTIVE",
        prompts: [],
        metrics: { attempts_count: 0, accuracy: 0 },
      },
    });
    const result = await scheduleFollowups(userId, activeRunId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("run_not_completed");
  });
});
