/**
 * Integration tests for the full session → run → attempt → complete flow.
 *
 * These tests exercise the service layer directly (no HTTP). They require a
 * running PostgreSQL database. Set DATABASE_URL to a test database before running.
 *
 * Run: DATABASE_URL=<test_db_url> npm run test:integration
 *
 * If no DATABASE_URL is available, tests are skipped automatically.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

// Dynamic imports so the module doesn't crash when DATABASE_URL is missing
let prisma: any;
let createSession: any;
let startOrResumeRun: any;
let submitAttempt: any;
let completeRun: any;
let getRun: any;
let endBreak: any;

describe.skipIf(!hasDb)("Integration: full session flow", () => {
  const userId = "test_user_integ";
  const otherUserId = "test_user_other";
  let sessionId: string;
  let runId: string;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
    completeRun = runService.completeRun;
    getRun = runService.getRun;
    endBreak = runService.endBreak;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Clean up test data
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.$disconnect();
  });

  // ---- Session creation ----

  it("creates a session and returns session_id and calendar", async () => {
    const result = await createSession(userId, {
      course_name: "TEST 101",
      exam_name: "Exam 1",
      mode: "RETRIEVAL",
      topic_scope: "Unit Tests",
      planned_minutes: 30,
      objectives: [
        { id: "obj_1", title: "Testing basics" },
        { id: "obj_2", title: "Mocking" },
      ],
      target_outcome: { prompt_count: 4, target_accuracy: 0.75 },
      break_protocol: { type: "TEST_3_2", cycles: 2 },
    });

    expect(result.session_id).toBeDefined();
    expect(result.session_url).toContain(`/s/${result.session_id}`);
    expect(result.calendar.title).toBe("TEST 101 | Exam 1 | Retrieval: Unit Tests");
    sessionId = result.session_id;
  });

  // ---- Start run ----

  it("starts a run with generated prompts", async () => {
    const result = await startOrResumeRun(userId, sessionId);
    expect("data" in result).toBe(true);
    const data = result.data!;
    expect(data.status).toBe("ACTIVE");
    expect(data.current_index).toBe(0);
    expect(data.prompts).toHaveLength(4);
    expect(data.resumed).toBe(false);
    expect(data.metrics.attempts_count).toBe(0);
    runId = data.run_id;
  });

  it("start is idempotent — returns same active run", async () => {
    const result = await startOrResumeRun(userId, sessionId);
    expect("data" in result).toBe(true);
    expect(result.data!.run_id).toBe(runId);
    expect(result.data!.resumed).toBe(true);
  });

  // ---- Ownership enforcement ----

  it("denies other user from starting a run on this session", async () => {
    const result = await startOrResumeRun(otherUserId, sessionId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  it("denies other user from getting the run", async () => {
    const result = await getRun(otherUserId, runId);
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  // ---- Submit attempts ----

  it("submits a CORRECT attempt and advances index", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      user_answer: "Testing basics are important because...",
      self_score: "CORRECT",
      time_to_answer_seconds: 30,
    });
    expect("data" in result).toBe(true);
    const data = result.data!;
    expect(data.current_index).toBe(1);
    expect(data.metrics.correct_count).toBe(1);
    expect(data.metrics.attempts_count).toBe(1);
    expect(data.metrics.accuracy).toBe(1);
  });

  it("rejects duplicate attempt for already-submitted prompt_index", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      user_answer: "Duplicate",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });
    expect("error" in result).toBe(true);
    // Index 0 is behind currentIndex (1), so wrong_index fires before duplicate check
    expect(result.error).toBe("wrong_index");
  });

  it("rejects wrong prompt_index", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 5,
      user_answer: "Out of order",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("wrong_index");
  });

  it("denies other user from submitting attempt", async () => {
    const result = await submitAttempt(otherUserId, runId, {
      prompt_index: 1,
      user_answer: "Intruder",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("forbidden");
  });

  it("submits an INCORRECT attempt with error_log", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 1,
      user_answer: "Wrong answer about mocking",
      self_score: "INCORRECT",
      time_to_answer_seconds: 60,
      error_log: {
        error_type: "MISCONCEPTION",
        correction_rule: "Mocking replaces dependencies, not the SUT",
        variant_question: "When should you use a stub vs a mock?",
      },
    });
    expect("data" in result).toBe(true);
    const data = result.data!;
    expect(data.current_index).toBe(2);
    expect(data.metrics.incorrect_count).toBe(1);
    expect(data.metrics.accuracy).toBe(0.5); // 1 correct out of 2
  });

  it("submits PARTIAL attempt", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 2,
      user_answer: "Partial answer",
      self_score: "PARTIAL",
      time_to_answer_seconds: 40,
      error_log: {
        error_type: "MEMORY",
        correction_rule: "Remember the three testing levels",
      },
    });
    expect("data" in result).toBe(true);
    const data = result.data!;
    expect(data.metrics.partial_count).toBe(1);
    expect(data.metrics.attempts_count).toBe(3);
  });

  // ---- Completion ----

  it("completing last prompt marks run COMPLETED with followups", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 3,
      user_answer: "Final answer",
      self_score: "CORRECT",
      time_to_answer_seconds: 25,
    });
    expect("data" in result).toBe(true);
    const data = result.data!;
    expect(data.status).toBe("COMPLETED");
    expect(data.metrics.attempts_count).toBe(4);
    expect(data.metrics.correct_count).toBe(2);
    expect(data.metrics.accuracy).toBe(0.5);
    expect(data.metrics.recommended_followups).toBeDefined();
    expect(data.metrics.recommended_followups!.length).toBe(2);
    // 50% accuracy → days 1 and 2
    expect(data.metrics.recommended_followups![0].days_from_now).toBe(1);
  });

  it("rejects attempt after completion", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 4,
      user_answer: "Too late",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("run_completed");
  });

  // ---- Complete is idempotent ----

  it("completeRun on already-completed returns result without error", async () => {
    const result = await completeRun(userId, runId);
    expect("data" in result).toBe(true);
    expect(result.data!.status).toBe("COMPLETED");
    expect(result.data!.ended_at).toBeDefined();
  });

  // ---- Verify DB integrity ----

  it("DB records match: attempt counts, metrics, error logs", async () => {
    const runResult = await getRun(userId, runId);
    expect("data" in runResult).toBe(true);
    const run = runResult.data!;

    expect(run.attempts).toHaveLength(4);
    expect(run.error_logs).toHaveLength(2); // INCORRECT + PARTIAL

    const metrics = run.metrics as any;
    expect(metrics.correct_count).toBe(2);
    expect(metrics.incorrect_count).toBe(1);
    expect(metrics.partial_count).toBe(1);
    expect(metrics.attempts_count).toBe(4);
    expect(metrics.accuracy).toBe(0.5);
    expect(metrics.time_spent_seconds).toBe(30 + 60 + 40 + 25);

    // Verify error log content
    const misconception = run.error_logs.find((e: any) => e.error_type === "MISCONCEPTION");
    expect(misconception).toBeDefined();
    expect(misconception!.correction_rule).toBe("Mocking replaces dependencies, not the SUT");
  });

  // ---- 404 cases ----

  it("returns not_found for unknown session_id", async () => {
    const result = await startOrResumeRun(userId, "nonexistent_session");
    expect("error" in result).toBe(true);
    expect(result.error).toBe("session_not_found");
  });

  it("returns not_found for unknown run_id", async () => {
    const result = await getRun(userId, "nonexistent_run");
    expect("error" in result).toBe(true);
    expect(result.error).toBe("not_found");
  });
});

describe.skipIf(!hasDb)("Integration: break enforcement", () => {
  const userId = "test_user_break";
  let sessionId: string;
  let runId: string;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
    endBreak = runService.endBreak;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
  });

  it("sets up a session with TEST_1_1 break protocol", async () => {
    const result = await createSession(userId, {
      course_name: "BREAK TEST",
      exam_name: "Final",
      mode: "RETRIEVAL",
      topic_scope: "Breaks",
      planned_minutes: 15,
      objectives: [{ id: "obj_1", title: "Break logic" }],
      target_outcome: { prompt_count: 4 },
      break_protocol: { type: "TEST_1_1", cycles: 2 },
    });
    sessionId = result.session_id;
  });

  it("starts run with short break window", async () => {
    const result = await startOrResumeRun(userId, sessionId);
    runId = result.data!.run_id;
    expect(result.data!.break_state.work_duration_seconds).toBe(1);
  });

  it("after waiting, break triggers and blocks attempts", async () => {
    // Wait 1.5 seconds for break to trigger
    await new Promise((r) => setTimeout(r, 1500));

    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      user_answer: "Should be blocked",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("on_break");
  });

  it("end-break allows continuing", async () => {
    const breakResult = await endBreak(userId, runId);
    expect("data" in breakResult).toBe(true);
    expect(breakResult.data!.break_state.on_break).toBe(false);

    // Now attempt should succeed
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      user_answer: "Now it works",
      self_score: "CORRECT",
      time_to_answer_seconds: 5,
    });
    expect("data" in result).toBe(true);
    expect(result.data!.current_index).toBe(1);
  });
});
