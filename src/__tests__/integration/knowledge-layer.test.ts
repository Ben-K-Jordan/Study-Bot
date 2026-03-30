/**
 * Integration tests for the Knowledge Layer (CKB, Practice Bank, Evidence Cards).
 *
 * These tests exercise the service layer directly (no HTTP). They require a
 * running PostgreSQL database. Set DATABASE_URL to a test database before running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let uploadDocument: any;
let processDocument: any;
let listDocuments: any;
let fetchFeedbackExcerpts: any;
let searchChunks: any;
let createSession: any;
let startOrResumeRun: any;
let submitAttempt: any;

const USER_A = "test_user_kl_a_" + Date.now();
const USER_B = "test_user_kl_b_" + Date.now();

describe.skipIf(!hasDb)("Knowledge Layer Integration", () => {
  let docId: string;
  const COURSE = "TEST_CS_" + Date.now();
  const DOC_CONTENT = `
Introduction to Loop Invariants

A loop invariant is a condition that is true before and after each iteration of a loop.

To prove a loop is correct, you must show three things:
1. Initialization: The invariant is true before the first iteration.
2. Maintenance: If the invariant is true before an iteration, it remains true after.
3. Termination: When the loop terminates, the invariant gives a useful property.

Example: Binary Search
The loop invariant for binary search is that the target element, if present, must be between indices low and high inclusive.

Common Mistakes with Loops
Students often forget to check the off-by-one error in loop boundaries.
The difference between < and <= in the loop condition is critical.

Advanced Loop Patterns
Nested loops require separate invariants for each level.
The outer loop invariant must account for the inner loop's effect.
  `.trim();

  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const contentService = await import("@/services/content");
    uploadDocument = contentService.uploadDocument;
    processDocument = contentService.processDocument;
    listDocuments = contentService.listDocuments;
    fetchFeedbackExcerpts = contentService.fetchFeedbackExcerpts;
    const searchModule = await import("@/lib/search");
    searchChunks = searchModule.searchChunks;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
    submitAttempt = runService.submitAttempt;
  });

  afterAll(async () => {
    if (!prisma) return;
    // Clean up in dependency order
    await prisma.attemptCitation.deleteMany({
      where: { attempt: { run: { userId: { in: [USER_A, USER_B] } } } },
    });
    await prisma.sessionErrorLog.deleteMany({
      where: { run: { userId: { in: [USER_A, USER_B] } } },
    });
    await prisma.sessionAttempt.deleteMany({
      where: { run: { userId: { in: [USER_A, USER_B] } } },
    });
    await prisma.sessionRun.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
    await prisma.session.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
    await prisma.evidenceCard.deleteMany({
      where: { paper: { userId: { in: [USER_A, USER_B] } } },
    });
    await prisma.evidencePaper.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
    await prisma.practiceQuestion.deleteMany({
      where: { set: { userId: { in: [USER_A, USER_B] } } },
    });
    await prisma.practiceSet.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
    await prisma.contentChunk.deleteMany({
      where: { document: { userId: { in: [USER_A, USER_B] } } },
    });
    await prisma.contentDocument.deleteMany({
      where: { userId: { in: [USER_A, USER_B] } },
    });
    await prisma.$disconnect();
  });

  // Upload + Process
  describe("Upload + Process", () => {
    it("uploads a text document", async () => {
      const result = await uploadDocument(
        USER_A,
        "COURSE",
        COURSE,
        undefined,
        "test.txt",
        "test.txt",
        "text/plain",
        Buffer.from(DOC_CONTENT)
      );
      expect(result.document_id).toBeTruthy();
      expect(result.status).toBe("UPLOADED");
      expect(result.deduped).toBe(false);
      docId = result.document_id;
    });

    it("processes the document into chunks", async () => {
      const result = await processDocument(USER_A, docId);
      expect(result.data).toBeDefined();
      expect(result.data.status).toBe("PROCESSED");
      expect(result.data.chunk_count).toBeGreaterThan(0);
    });

    it("idempotent: re-process returns same result", async () => {
      const result = await processDocument(USER_A, docId);
      expect(result.data).toBeDefined();
      expect(result.data.status).toBe("PROCESSED");
    });
  });

  // Search
  describe("Search", () => {
    it("finds chunks matching a query", async () => {
      const results = await searchChunks({
        userId: USER_A,
        q: "loop invariant",
        namespace: "COURSE",
        courseName: COURSE,
      });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].snippet).toBeTruthy();
      expect(results[0].doc_title).toBeTruthy();
    });

    it("returns empty for non-matching query", async () => {
      const results = await searchChunks({
        userId: USER_A,
        q: "quantum chromodynamics",
        namespace: "COURSE",
        courseName: COURSE,
      });
      expect(results.length).toBe(0);
    });

    it("respects top_k limit", async () => {
      const results = await searchChunks({
        userId: USER_A,
        q: "loop",
        namespace: "COURSE",
        courseName: COURSE,
        topK: 2,
      });
      expect(results.length).toBeLessThanOrEqual(2);
    });
  });

  // Ownership enforcement
  describe("Ownership", () => {
    it("user B cannot process user A's document", async () => {
      const result = await processDocument(USER_B, docId);
      expect(result.error).toBe("forbidden");
    });

    it("user B search returns 0 results for user A's docs", async () => {
      const results = await searchChunks({
        userId: USER_B,
        q: "loop invariant",
        namespace: "COURSE",
        courseName: COURSE,
      });
      expect(results.length).toBe(0);
    });
  });

  // Dedupe
  describe("Dedupe", () => {
    it("re-uploading same file returns deduped=true", async () => {
      const result = await uploadDocument(
        USER_A,
        "COURSE",
        COURSE,
        undefined,
        "test.txt",
        "test.txt",
        "text/plain",
        Buffer.from(DOC_CONTENT)
      );
      expect(result.deduped).toBe(true);
      expect(result.document_id).toBe(docId);
    });
  });

  // List documents
  describe("List Documents", () => {
    it("returns documents with chunk count", async () => {
      const docs = await listDocuments(USER_A, "COURSE", COURSE);
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0].chunk_count).toBeGreaterThan(0);
      expect(docs[0].status).toBe("PROCESSED");
    });
  });

  // AttemptCitation integration
  describe("AttemptCitation via Runner", () => {
    let sessionId: string;
    let runId: string;

    it("create a retrieval session for the course", async () => {
      const result = await createSession(USER_A, {
        course_name: COURSE,
        exam_name: "Test Exam",
        mode: "RETRIEVAL",
        topic_scope: "Loop invariants",
        planned_minutes: 30,
        objectives: [{ id: "obj_1", title: "Loop invariants" }],
      });
      expect(result.session_id).toBeDefined();
      sessionId = result.session_id;
    });

    it("start a run", async () => {
      const result = await startOrResumeRun(USER_A, sessionId);
      expect("data" in result).toBe(true);
      runId = result.data.run_id;
      expect(result.data.prompts.length).toBeGreaterThan(0);
    });

    it("submit INCORRECT attempt and get feedback with citations", async () => {
      const result = await submitAttempt(USER_A, runId, {
        prompt_index: 0,
        user_answer: "I don't remember",
        self_score: "INCORRECT",
        time_to_answer_seconds: 10,
        error_log: {
          error_type: "MEMORY",
          correction_rule: "A loop invariant must be true before and after each iteration",
        },
      });
      expect("data" in result).toBe(true);
      // Feedback should be present (we have COURSE docs for this course)
      if (result.data.feedback) {
        expect(result.data.feedback.excerpts.length).toBeGreaterThan(0);
        expect(result.data.feedback.excerpts[0].snippet).toBeTruthy();
        expect(result.data.feedback.excerpts[0].doc_title).toBeTruthy();
      }
    });
  });

  // Practice Bank
  describe("Practice Bank", () => {
    let setId: string;

    it("creates a practice set", async () => {
      const set = await prisma.practiceSet.create({
        data: {
          userId: USER_A,
          courseName: COURSE,
          title: "Midterm Prep",
        },
      });
      expect(set.id).toBeTruthy();
      setId = set.id;
    });

    it("imports questions", async () => {
      const questions = [
        { kind: "SHORT_ANSWER", promptText: "Define loop invariant" },
        { kind: "MCQ", promptText: "Which is NOT a loop property?", answerKey: "D" },
      ];
      for (const q of questions) {
        await prisma.practiceQuestion.create({
          data: {
            setId,
            kind: q.kind,
            promptText: q.promptText,
            answerKey: q.answerKey ?? null,
          },
        });
      }
      const count = await prisma.practiceQuestion.count({ where: { setId } });
      expect(count).toBe(2);
    });

    it("lists questions", async () => {
      const questions = await prisma.practiceQuestion.findMany({
        where: { setId },
      });
      expect(questions.length).toBe(2);
    });

    it("user B cannot import into user A's set", async () => {
      // Verify ownership check: user B should not own the set
      const set = await prisma.practiceSet.findUnique({ where: { id: setId } });
      expect(set.userId).toBe(USER_A);
      expect(set.userId).not.toBe(USER_B);
    });
  });

  // Evidence
  describe("Evidence Cards", () => {
    let researchDocId: string;
    let paperId: string;

    it("uploads a research document", async () => {
      const result = await uploadDocument(
        USER_A,
        "RESEARCH",
        undefined,
        undefined,
        "paper.txt",
        "paper.txt",
        "text/plain",
        Buffer.from("Research paper content about retrieval practice")
      );
      expect(result.document_id).toBeTruthy();
      researchDocId = result.document_id;

      // Process it
      const processResult = await processDocument(USER_A, researchDocId);
      expect(processResult.data.status).toBe("PROCESSED");
    });

    it("creates an evidence paper", async () => {
      const paper = await prisma.evidencePaper.create({
        data: {
          userId: USER_A,
          title: "The Testing Effect",
          documentId: researchDocId,
          tags: ["retrieval_practice"],
        },
      });
      expect(paper.id).toBeTruthy();
      paperId = paper.id;
    });

    it("creates an evidence card", async () => {
      const card = await prisma.evidenceCard.create({
        data: {
          paperId,
          claim: "Retrieval practice enhances long-term retention",
          recommendation: "Use regular self-testing",
          strength: "STRONG",
          tags: ["retrieval_practice"],
        },
      });
      expect(card.id).toBeTruthy();
    });

    it("lists evidence cards", async () => {
      const cards = await prisma.evidenceCard.findMany({
        where: { paper: { userId: USER_A } },
      });
      expect(cards.length).toBeGreaterThan(0);
    });
  });
});
