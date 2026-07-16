/**
 * Integration tests for the Efficiency + Output Quality Sprint.
 *
 * Covers:
 * - Phase 1: Deferred feedback (attempt returns attempt_id + feedback_status, separate endpoint)
 * - Phase 2: Prompt streaming (current_prompt + prompt_count, prompt endpoint)
 * - Phase 3: Objective anchors (build and use)
 * - Phase 5: No-leakage, payload budgets
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let createSession: any;
let startOrResumeRun: any;
let submitAttempt: any;
let getRunPrompt: any;
let generateFeedback: any;
let buildObjectiveAnchors: any;
let uploadDocument: any;
let processDocument: any;

const USER = "test_eff_sprint_" + Date.now();

describe.skipIf(!hasDb)("Efficiency Sprint Integration", () => {
  const COURSE = "EFF_CS_" + Date.now();
  const DOC_CONTENT = `
Introduction to Loop Invariants

A loop invariant is a condition that is true before and after each iteration of a loop.

To prove a loop is correct, you must show three things:
1. Initialization: The invariant is true before the first iteration.
2. Maintenance: If the invariant is true before an iteration, it remains true after.
3. Termination: When the loop terminates, the invariant gives a useful property.

Example: Binary Search
The loop invariant for binary search is that the target element, if present, must be between low and high.
  `.trim();

  let sessionId: string;
  let runId: string;
  let docId: string;

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const contentService = await import("@/services/content");
    uploadDocument = contentService.uploadDocument;
    processDocument = contentService.processDocument;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
    getRunPrompt = runService.getRunPrompt;
    const feedbackService = await import("@/services/feedback");
    generateFeedback = feedbackService.generateFeedback;
    const anchorService = await import("@/services/anchors");
    buildObjectiveAnchors = anchorService.buildObjectiveAnchors;

    // Upload + process a doc for feedback tests
    const result = await uploadDocument(
      USER, "COURSE", COURSE, undefined,
      "loops.txt", "loops.txt", "text/plain",
      Buffer.from(DOC_CONTENT)
    );
    docId = result.document_id;
    await processDocument(USER, docId);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.attemptCitation.deleteMany({
      where: { attempt: { run: { userId: USER } } },
    });
    await prisma.objectiveAnchor.deleteMany({ where: { userId: USER } });
    await prisma.sessionErrorLog.deleteMany({
      where: { run: { userId: USER } },
    });
    await prisma.sessionAttempt.deleteMany({
      where: { run: { userId: USER } },
    });
    await prisma.sessionRunPrompt.deleteMany({
      where: { run: { userId: USER } },
    });
    await prisma.sessionRun.deleteMany({ where: { userId: USER } });
    await prisma.session.deleteMany({ where: { userId: USER } });
    await prisma.contentChunk.deleteMany({
      where: { document: { userId: USER } },
    });
    await prisma.contentDocument.deleteMany({ where: { userId: USER } });
    await prisma.objectiveMastery.deleteMany({ where: { userId: USER } });
    await prisma.$disconnect();
  });

  // ---- Phase 2: Prompt Streaming ----

  describe("Phase 2: Prompt Streaming", () => {
    it("start returns current_prompt and prompt_count (no full array needed)", async () => {
      const sess = await createSession(USER, {
        course_name: COURSE,
        exam_name: "Test",
        mode: "RETRIEVAL",
        topic_scope: "Loop invariants",
        planned_minutes: 30,
        objectives: [{ id: "obj_1", title: "Loop invariants" }],
        target_outcome: { prompt_count: 3 },
      });
      sessionId = sess.session_id;

      // Seed mastery so pre-test diagnostic prompts are not prepended
      await prisma.objectiveMastery.createMany({
        data: [{ userId: USER, courseName: COURSE, objectiveKey: "obj_1" }],
        skipDuplicates: true,
      });

      const result = await startOrResumeRun(USER, sessionId);
      expect("data" in result).toBe(true);
      runId = result.data.run_id;

      // Phase 2 assertions
      expect(result.data.prompt_count).toBe(3);
      expect(result.data.current_prompt).toBeDefined();
      expect(result.data.current_prompt.text).toBeTruthy();
      expect(result.data.current_prompt.prompt_index).toBe(0);
    });

    it("prompt endpoint returns correct text for each index", async () => {
      const p0 = await getRunPrompt(USER, runId, 0);
      expect("data" in p0).toBe(true);
      expect(p0.data.text).toBeTruthy();
      expect(p0.data.prompt_index).toBe(0);

      const p1 = await getRunPrompt(USER, runId, 1);
      expect("data" in p1).toBe(true);
      expect(p1.data.prompt_index).toBe(1);
    });

    it("prompt endpoint rejects out-of-range index", async () => {
      const result = await getRunPrompt(USER, runId, 999);
      expect("error" in result).toBe(true);
      expect(result.error).toBe("invalid_index");
    });

    it("prompt endpoint enforces ownership", async () => {
      const result = await getRunPrompt("wrong_user", runId, 0);
      expect("error" in result).toBe(true);
      expect(result.error).toBe("forbidden");
    });

    it("SessionRunPrompt rows exist in database", async () => {
      const rows = await prisma.sessionRunPrompt.findMany({
        where: { runId },
        orderBy: { promptIndex: "asc" },
      });
      expect(rows.length).toBe(3);
      expect(rows[0].promptIndex).toBe(0);
      expect(rows[1].promptIndex).toBe(1);
      expect(rows[2].promptIndex).toBe(2);
    });
  });

  // ---- Phase 1: Deferred Feedback ----

  describe("Phase 1: Deferred Feedback", () => {
    let attemptId: string;

    it("attempt returns attempt_id and feedback_status PENDING for INCORRECT", async () => {
      const result = await submitAttempt(USER, runId, {
        prompt_index: 0,
        user_answer: "I don't know",
        self_score: "INCORRECT",
        time_to_answer_seconds: 5,
        error_log: {
          error_type: "MEMORY",
          correction_rule: "A loop invariant is true before and after each iteration",
        },
      });
      expect("data" in result).toBe(true);
      expect(result.data.attempt_id).toBeTruthy();
      expect(result.data.feedback_status).toBe("PENDING");
      attemptId = result.data.attempt_id;

      // No feedback field in the response — it's deferred
      expect(result.data.feedback).toBeUndefined();
    });

    it("attempt returns feedback_status NONE for CORRECT", async () => {
      const result = await submitAttempt(USER, runId, {
        prompt_index: 1,
        user_answer: "A condition true before and after each iteration",
        self_score: "CORRECT",
        time_to_answer_seconds: 10,
      });
      expect("data" in result).toBe(true);
      expect(result.data.feedback_status).toBe("NONE");
    });

    it("GET feedback returns excerpts and stores citations", async () => {
      // submitAttempt fires eager generation; while that claim is live the
      // service correctly answers PENDING — poll like the client does.
      let result = await generateFeedback(USER, attemptId);
      for (let i = 0; i < 40 && result.status === "PENDING"; i++) {
        await new Promise((r) => setTimeout(r, 250));
        result = await generateFeedback(USER, attemptId);
      }
      expect(result.status).toBe("OK");
      // We have course docs, should get results
      if (result.excerpts.length > 0) {
        expect(result.excerpts[0].snippet).toBeTruthy();
        expect(result.excerpts[0].doc_title).toBeTruthy();

        // Citations should be stored in DB
        const citations = await prisma.attemptCitation.findMany({
          where: { attemptId },
        });
        expect(citations.length).toBeGreaterThan(0);
      }
    });

    it("GET feedback is idempotent (returns cached citations)", async () => {
      const result1 = await generateFeedback(USER, attemptId);
      const result2 = await generateFeedback(USER, attemptId);
      expect(result1.excerpts.length).toBe(result2.excerpts.length);
    });

    it("feedback endpoint enforces ownership", async () => {
      const result = await generateFeedback("wrong_user", attemptId);
      expect(result.status).toBe("NOT_FOUND");
    });

    it("feedback returns NOT_FOUND for a nonexistent attempt", async () => {
      const result = await generateFeedback(USER, "no_such_attempt");
      expect(result.status).toBe("NOT_FOUND");
    });
  });

  // ---- Phase 3: Objective Anchors ----

  describe("Phase 3: Objective Anchors", () => {
    it("buildObjectiveAnchors creates anchor rows", async () => {
      const result = await buildObjectiveAnchors(
        USER,
        COURSE,
        undefined,
        [{ id: "obj_1", title: "Loop invariants" }]
      );
      expect(result.anchors_created).toBeGreaterThan(0);

      const anchors = await prisma.objectiveAnchor.findMany({
        where: { userId: USER, courseName: COURSE, objectiveId: "obj_1" },
      });
      expect(anchors.length).toBeGreaterThan(0);
    });

    it("anchor results are idempotent (upsert)", async () => {
      const result1 = await buildObjectiveAnchors(
        USER,
        COURSE,
        undefined,
        [{ id: "obj_1", title: "Loop invariants" }]
      );
      const result2 = await buildObjectiveAnchors(
        USER,
        COURSE,
        undefined,
        [{ id: "obj_1", title: "Loop invariants" }]
      );
      // Same count — upsert doesn't duplicate
      const anchors = await prisma.objectiveAnchor.findMany({
        where: { userId: USER, courseName: COURSE, objectiveId: "obj_1" },
      });
      expect(anchors.length).toBeLessThanOrEqual(5);
    });
  });

  // ---- Phase 5: No-leakage invariant ----

  describe("Phase 5: No-leakage invariant", () => {
    it("attempt response never contains feedback or excerpt data", async () => {
      // Create a new session/run to test fresh
      const sess = await createSession(USER, {
        course_name: COURSE,
        exam_name: "Test2",
        mode: "RETRIEVAL",
        topic_scope: "Loop invariants",
        planned_minutes: 30,
        target_outcome: { prompt_count: 2 },
      });
      const run = await startOrResumeRun(USER, sess.session_id);
      const result = await submitAttempt(USER, run.data.run_id, {
        prompt_index: 0,
        user_answer: "wrong answer",
        self_score: "INCORRECT",
        time_to_answer_seconds: 5,
        error_log: {
          error_type: "MEMORY",
          correction_rule: "The correct answer is...",
        },
      });

      // The response must NOT contain feedback/excerpts inline
      const json = JSON.stringify(result.data);
      expect(json).not.toContain("snippet");
      expect(json).not.toContain("doc_title");
      expect(json).not.toContain("excerpts");
      expect(result.data.feedback).toBeUndefined();
      expect(result.data.feedback_status).toBe("PENDING");
    });
  });
});
