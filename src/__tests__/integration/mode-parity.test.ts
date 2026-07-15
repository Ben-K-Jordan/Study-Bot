/**
 * Integration tests for Runner Mode Parity: INTERLEAVED_PRACTICE, EXAM_SIM, ERROR_REPAIR.
 *
 * Requires running PostgreSQL. Set DATABASE_URL to a test database.
 * Run: DATABASE_URL=<test_db_url> npm run test:integration
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let createSession: any;
let startOrResumeRun: any;
let submitAttempt: any;
let completeRun: any;
let getRun: any;
let endBreak: any;

// ============================================================
// INTERLEAVED_PRACTICE
// ============================================================

describe.skipIf(!hasDb)("Integration: INTERLEAVED_PRACTICE mode", () => {
  const userId = "test_interleaved_user";
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
    getRun = runService.getRun;

    // Seed mastery records so pre-test diagnostic prompts are not prepended
    await prisma.objectiveMastery.createMany({
      data: [
        { userId, courseName: "TEST 201", objectiveKey: "obj_a" },
        { userId, courseName: "TEST 201", objectiveKey: "obj_b" },
      ],
      skipDuplicates: true,
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.objectiveMastery.deleteMany({ where: { userId } });
  });

  it("creates an interleaved session", async () => {
    const result = await createSession(userId, {
      course_name: "TEST 201",
      exam_name: "Midterm",
      mode: "INTERLEAVED_PRACTICE",
      topic_scope: "Ch1-Ch3",
      planned_minutes: 30,
      objectives: [
        { id: "obj_a", title: "Loops" },
        { id: "obj_b", title: "Arrays" },
      ],
      target_outcome: { prompt_count: 4 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });
    sessionId = result.session_id;
    expect(sessionId).toBeDefined();
  });

  it("starts run with mode=INTERLEAVED_PRACTICE, phase=ACTIVE, policies.scoring=IMMEDIATE", async () => {
    const result = await startOrResumeRun(userId, sessionId);
    expect("data" in result).toBe(true);
    const d = result.data!;
    expect(d.mode).toBe("INTERLEAVED_PRACTICE");
    expect(d.phase).toBe("ACTIVE");
    expect(d.policies.scoring).toBe("IMMEDIATE");
    expect(d.prompts).toHaveLength(4);
    runId = d.run_id;
  });

  it("prompts alternate objectives in first prompts", async () => {
    const result = await getRun(userId, runId);
    const prompts = result.data!.prompts as any[];
    // Round-robin interleaving means first two have different objectives
    expect(prompts[0].objective_id).not.toBe(prompts[1].objective_id);
  });

  it("can submit all prompts with immediate scoring and complete", async () => {
    for (let i = 0; i < 4; i++) {
      const result = await submitAttempt(userId, runId, {
        prompt_index: i,
        user_answer: `Interleaved answer ${i}`,
        self_score: "CORRECT",
        time_to_answer_seconds: 10,
      });
      expect("data" in result).toBe(true);
    }

    const run = await getRun(userId, runId);
    expect(run.data!.status).toBe("COMPLETED");
    expect(run.data!.metrics.attempts_count).toBe(4);
    expect(run.data!.metrics.accuracy).toBe(1);
  });
});

// ============================================================
// EXAM_SIM
// ============================================================

describe.skipIf(!hasDb)("Integration: EXAM_SIM mode", () => {
  const userId = "test_examsim_user";
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
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
  });

  it("creates an EXAM_SIM session", async () => {
    const result = await createSession(userId, {
      course_name: "TEST 301",
      exam_name: "Final",
      mode: "EXAM_SIM",
      topic_scope: "All chapters",
      planned_minutes: 60,
      objectives: [
        { id: "obj_1", title: "Topic A" },
        { id: "obj_2", title: "Topic B" },
      ],
      target_outcome: { prompt_count: 3 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });
    sessionId = result.session_id;
  });

  it("starts run with mode=EXAM_SIM, phase=EXAM, policies.scoring=DELAYED", async () => {
    const result = await startOrResumeRun(userId, sessionId);
    const d = result.data!;
    expect(d.mode).toBe("EXAM_SIM");
    expect(d.phase).toBe("EXAM");
    expect(d.policies.scoring).toBe("DELAYED");
    expect(d.answered_count).toBe(0);
    expect(d.scored_count).toBe(0);
    expect(d.prompts).toHaveLength(3);
    runId = d.run_id;
  });

  it("rejects SCORE kind during EXAM phase", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      kind: "SCORE",
      self_score: "CORRECT",
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("wrong_phase");
  });

  it("ANSWER stores attempt with self_score null", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      kind: "ANSWER",
      user_answer: "My exam answer for prompt 0",
      time_to_answer_seconds: 30,
    });
    expect("data" in result).toBe(true);
    expect(result.data!.phase).toBe("EXAM");
    expect(result.data!.current_index).toBe(1);
    expect(result.data!.answered_count).toBe(1);

    // Verify DB: self_score should be null
    const attempt = await prisma.sessionAttempt.findFirst({
      where: { runId, promptIndex: 0 },
    });
    expect(attempt.selfScore).toBeNull();
  });

  it("answers remaining prompts and transitions to REVIEW", async () => {
    // Answer prompt 1
    const r1 = await submitAttempt(userId, runId, {
      prompt_index: 1,
      kind: "ANSWER",
      user_answer: "Exam answer 1",
      time_to_answer_seconds: 20,
    });
    expect(r1.data!.phase).toBe("EXAM");
    expect(r1.data!.answered_count).toBe(2);

    // Answer prompt 2 (last) — should transition to REVIEW
    const r2 = await submitAttempt(userId, runId, {
      prompt_index: 2,
      kind: "ANSWER",
      user_answer: "Exam answer 2",
      time_to_answer_seconds: 25,
    });
    expect(r2.data!.phase).toBe("REVIEW");
    expect(r2.data!.current_index).toBe(0); // Reset to 0 for review
    expect(r2.data!.answered_count).toBe(3);
    expect(r2.data!.scored_count).toBe(0);
  });

  it("rejects ANSWER kind during REVIEW phase", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      kind: "ANSWER",
      user_answer: "should fail",
    });
    expect("error" in result).toBe(true);
    expect(result.error).toBe("wrong_phase");
  });

  it("SCORE updates existing attempt row (not insert)", async () => {
    const beforeCount = await prisma.sessionAttempt.count({ where: { runId } });
    expect(beforeCount).toBe(3); // 3 from EXAM phase

    const result = await submitAttempt(userId, runId, {
      prompt_index: 0,
      kind: "SCORE",
      self_score: "CORRECT",
    });
    expect("data" in result).toBe(true);
    expect(result.data!.scored_count).toBe(1);

    const afterCount = await prisma.sessionAttempt.count({ where: { runId } });
    expect(afterCount).toBe(3); // Same count — updated, not inserted

    const attempt = await prisma.sessionAttempt.findFirst({
      where: { runId, promptIndex: 0 },
    });
    expect(attempt.selfScore).toBe("CORRECT");
  });

  it("SCORE with INCORRECT requires error_log, creates error log row", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 1,
      kind: "SCORE",
      self_score: "INCORRECT",
      error_log: {
        error_type: "MISCONCEPTION",
        correction_rule: "The correct answer is B",
        variant_question: "Why is B correct?",
      },
    });
    expect("data" in result).toBe(true);
    expect(result.data!.scored_count).toBe(2);

    const errorLog = await prisma.sessionErrorLog.findFirst({
      where: { runId, promptIndex: 1 },
    });
    expect(errorLog).toBeDefined();
    expect(errorLog.errorType).toBe("MISCONCEPTION");
  });

  it("final SCORE completes the run", async () => {
    const result = await submitAttempt(userId, runId, {
      prompt_index: 2,
      kind: "SCORE",
      self_score: "CORRECT",
    });
    expect("data" in result).toBe(true);
    expect(result.data!.status).toBe("COMPLETED");
    expect(result.data!.phase).toBe("COMPLETE");
    expect(result.data!.scored_count).toBe(3);
    expect(result.data!.metrics.accuracy).toBeCloseTo(2 / 3, 5);
    expect(result.data!.metrics.recommended_followups).toBeDefined();
  });

  it("complete is idempotent", async () => {
    const result = await completeRun(userId, runId);
    expect("data" in result).toBe(true);
    expect(result.data!.status).toBe("COMPLETED");
  });
});

// ============================================================
// ERROR_REPAIR
// ============================================================

describe.skipIf(!hasDb)("Integration: ERROR_REPAIR mode", () => {
  const userId = "test_errorrepair_user";
  let retrievalSessionId: string;
  let retrievalRunId: string;
  let repairSessionId: string;
  let repairRunId: string;
  let errorLogId: string;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
    getRun = runService.getRun;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sessionErrorLog.deleteMany({ where: { run: { userId } } });
    await prisma.sessionAttempt.deleteMany({ where: { run: { userId } } });
    await prisma.sessionRun.deleteMany({ where: { userId } });
    await prisma.session.deleteMany({ where: { userId } });
  });

  // Step 1: Create a retrieval session and generate an error log
  it("creates a retrieval session and submits an INCORRECT to create an error log", async () => {
    const result = await createSession(userId, {
      course_name: "REPAIR TEST",
      exam_name: "Quiz 1",
      mode: "RETRIEVAL",
      topic_scope: "Errors",
      planned_minutes: 15,
      objectives: [{ id: "obj_1", title: "Error handling" }],
      target_outcome: { prompt_count: 2 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });
    retrievalSessionId = result.session_id;

    const startResult = await startOrResumeRun(userId, retrievalSessionId);
    retrievalRunId = startResult.data!.run_id;

    // Submit INCORRECT with error log
    await submitAttempt(userId, retrievalRunId, {
      prompt_index: 0,
      user_answer: "Wrong answer",
      self_score: "INCORRECT",
      time_to_answer_seconds: 15,
      error_log: {
        error_type: "MISCONCEPTION",
        correction_rule: "Always handle exceptions in catch blocks",
        variant_question: "What happens if you don't catch an exception?",
      },
    });

    // Submit CORRECT to complete
    await submitAttempt(userId, retrievalRunId, {
      prompt_index: 1,
      user_answer: "Correct answer",
      self_score: "CORRECT",
      time_to_answer_seconds: 10,
    });

    // Verify error log was created
    const errorLogs = await prisma.sessionErrorLog.findMany({
      where: { runId: retrievalRunId, resolvedAt: null },
    });
    expect(errorLogs).toHaveLength(1);
    errorLogId = errorLogs[0].id;
  });

  // Step 2: Create an ERROR_REPAIR session
  it("starts an ERROR_REPAIR run with repair prompts from unresolved errors", async () => {
    const result = await createSession(userId, {
      course_name: "REPAIR TEST",
      exam_name: "Quiz 1",
      mode: "ERROR_REPAIR",
      topic_scope: "Errors",
      planned_minutes: 15,
      target_outcome: { prompt_count: 5 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });
    repairSessionId = result.session_id;

    const startResult = await startOrResumeRun(userId, repairSessionId);
    const d = startResult.data!;
    expect(d.mode).toBe("ERROR_REPAIR");
    expect(d.phase).toBe("ACTIVE");
    expect(d.policies.scoring).toBe("IMMEDIATE");
    // Should have 1 repair prompt (only 1 unresolved error)
    expect(d.prompts.length).toBeGreaterThanOrEqual(1);
    repairRunId = d.run_id;

    // First prompt should reference the error log
    const firstPrompt = d.prompts[0] as any;
    expect(firstPrompt.meta?.source_error_log_id).toBe(errorLogId);
  });

  it("one CORRECT repair increments the streak but does not resolve (criterion: 2 days)", async () => {
    const run = await getRun(userId, repairRunId);
    const prompts = run.data!.prompts as any[];

    // Submit CORRECT for each prompt
    for (let i = 0; i < prompts.length; i++) {
      await submitAttempt(userId, repairRunId, {
        prompt_index: i,
        user_answer: "Correct repair answer",
        self_score: "CORRECT",
        time_to_answer_seconds: 10,
      });
    }

    // Successive relearning (Rawson & Dunlosky 2011): one correct retrieval
    // is not resolution — the streak advances, resolution needs a second
    // correct retrieval on a different day.
    const errorLog = await prisma.sessionErrorLog.findUnique({
      where: { id: errorLogId },
    });
    expect(errorLog.resolvedAt).toBeNull();
    expect(errorLog.correctStreak).toBe(1);
    expect(errorLog.lastCorrectAt).not.toBeNull();
  });

  it("a second CORRECT retrieval on a later day resolves the error", async () => {
    // Simulate the first success having happened yesterday (the criterion
    // requires correct retrievals on different calendar days)
    await prisma.sessionErrorLog.update({
      where: { id: errorLogId },
      data: { lastCorrectAt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    });

    const result = await createSession(userId, {
      course_name: "REPAIR TEST DAY2",
      exam_name: "Quiz 1",
      mode: "ERROR_REPAIR",
      topic_scope: "Errors",
      planned_minutes: 15,
      target_outcome: { prompt_count: 5 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });
    const startResult = await startOrResumeRun(userId, result.session_id);
    const d = startResult.data!;
    const prompts = d.prompts as any[];

    for (let i = 0; i < prompts.length; i++) {
      await submitAttempt(userId, d.run_id, {
        prompt_index: i,
        user_answer: "Correct repair answer, day 2",
        self_score: "CORRECT",
        time_to_answer_seconds: 10,
      });
    }

    const errorLog = await prisma.sessionErrorLog.findUnique({
      where: { id: errorLogId },
    });
    expect(errorLog.resolvedAt).not.toBeNull();
    expect(errorLog.correctStreak).toBe(2);
  });

  it("resolved errors are not included in new ERROR_REPAIR decks", async () => {
    // Create another repair session
    const result = await createSession(userId, {
      course_name: "REPAIR TEST 2",
      exam_name: "Quiz 2",
      mode: "ERROR_REPAIR",
      topic_scope: "Errors",
      planned_minutes: 15,
      target_outcome: { prompt_count: 5 },
      break_protocol: { type: "TEST_3_2", cycles: 1 },
    });

    const startResult = await startOrResumeRun(userId, result.session_id);
    const d = startResult.data!;
    // No unresolved errors left, so should fall back to retrieval prompts
    const prompts = d.prompts as any[];
    // None should reference the resolved error log
    for (const p of prompts) {
      expect(p.meta?.source_error_log_id).not.toBe(errorLogId);
    }
  });
});

// ============================================================
// Phase enforcement across modes
// ============================================================

describe.skipIf(!hasDb)("Integration: ownership enforcement remains for new modes", () => {
  const userId = "test_ownership_modes";
  const otherUser = "test_ownership_other";
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
    getRun = runService.getRun;
  });

  afterAll(async () => {
    if (!prisma) return;
    for (const uid of [userId, otherUser]) {
      await prisma.sessionErrorLog.deleteMany({ where: { run: { userId: uid } } });
      await prisma.sessionAttempt.deleteMany({ where: { run: { userId: uid } } });
      await prisma.sessionRun.deleteMany({ where: { userId: uid } });
      await prisma.session.deleteMany({ where: { userId: uid } });
    }
  });

  it("denies other user from starting EXAM_SIM run", async () => {
    const result = await createSession(userId, {
      course_name: "OWN",
      exam_name: "Test",
      mode: "EXAM_SIM",
      topic_scope: "T",
      planned_minutes: 30,
      target_outcome: { prompt_count: 2 },
    });
    sessionId = result.session_id;

    const startResult = await startOrResumeRun(userId, sessionId);
    runId = startResult.data!.run_id;

    // Other user tries to start
    const otherResult = await startOrResumeRun(otherUser, sessionId);
    expect(otherResult.error).toBe("forbidden");
  });

  it("denies other user from submitting attempt", async () => {
    const result = await submitAttempt(otherUser, runId, {
      prompt_index: 0,
      kind: "ANSWER",
      user_answer: "intruder",
    });
    expect(result.error).toBe("forbidden");
  });
});
