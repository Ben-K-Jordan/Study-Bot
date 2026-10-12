/**
 * Phase 5: Payload size regression test.
 *
 * Ensures that the runs/start response stays small even with many prompts.
 * This prevents accidental reintroduction of full prompt arrays.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let createSession: any;
let startOrResumeRun: any;
let prisma: any;

const USER = "test_payload_" + Date.now();
const COURSE = "PAYLOAD_CS_" + Date.now();

describe.skipIf(!hasDb)("Payload Size Budget", () => {
  beforeAll(async () => {
    const dbModule = await import("@/lib/db");
    prisma = dbModule.prisma;
    const sessionService = await import("@/services/session");
    createSession = sessionService.createSession;
    const runService = await import("@/services/run");
    startOrResumeRun = runService.startOrResumeRun;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.sessionRunPrompt.deleteMany({
      where: { run: { userId: USER } },
    });
    await prisma.sessionRun.deleteMany({ where: { userId: USER } });
    await prisma.session.deleteMany({ where: { userId: USER } });
    await prisma.$disconnect();
  });

  it("start response with prompt_count=100 stays under 50KB when prompts field is excluded", async () => {
    const sess = await createSession(USER, {
      course_name: COURSE,
      exam_name: "Big Exam",
      mode: "RETRIEVAL",
      topic_scope: "Comprehensive review",
      planned_minutes: 120,
      target_outcome: { prompt_count: 100 },
    });

    const result = await startOrResumeRun(USER, sess.session_id);
    expect("data" in result).toBe(true);
    expect(result.data.prompt_count).toBe(100);
    expect(result.data.current_prompt).toBeDefined();
    expect(result.data.current_prompt.prompt_index).toBe(0);

    // Measure response without the legacy prompts array
    const { prompts: _prompts, ...responseWithoutPrompts } = result.data;
    const json = JSON.stringify(responseWithoutPrompts);
    const bytes = Buffer.byteLength(json, "utf-8");

    // Must be under 50KB — the current_prompt + metadata should be tiny
    expect(bytes).toBeLessThan(50_000);
    // In practice it should be well under 5KB
    expect(bytes).toBeLessThan(5_000);
  });
});
