import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The end screen's data: follow-up dates from the scheduler (anchored to
 * when the run ended, so they don't drift after a reload), honest counts
 * (pretest and repair questions), and owner checks. Prisma is mocked.
 */
const db = vi.hoisted(() => ({
  session: { findMany: vi.fn(), findUnique: vi.fn() },
  sessionRun: { findUnique: vi.fn(), findFirst: vi.fn() },
  studyPlan: { findFirst: vi.fn() },
  studyPlanItem: { findMany: vi.fn(), findFirst: vi.fn() },
  userGameState: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
vi.mock("@/services/run", () => ({ getDeckPreview: vi.fn() }));

import { compositionFromDeck, getFollowupPreview, getSessionResults } from "@/services/session";

const USER = "user-1";
// 2026-10-15 19:00 UTC = 3:00 PM in New York
const ENDED_AT = new Date("2026-10-15T19:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  db.userGameState.findUnique.mockResolvedValue({ timezone: "America/New_York" });
});

describe("getFollowupPreview", () => {
  it("recommends days in the student's zone when there is no plan", async () => {
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findFirst.mockResolvedValue(null);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.5 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("no_plan");
    expect(preview.timezone).toBe("America/New_York");
    // Accuracy under 70% brings follow-ups 1 and 2 days after the run ended.
    expect(preview.items.map((i) => i.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(preview.items[0].at).toBe("2026-10-16T16:00:00.000Z");
  });

  it("uses the scheduler's plan dates and skips days after the exam", async () => {
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findFirst.mockResolvedValue({
      planId: "plan-1",
      examName: "Prelim 2",
      examDate: new Date("2026-10-19T00:00:00Z"),
      startDate: new Date("2026-10-10T00:00:00Z"),
      timezone: "America/New_York",
      config: { availability: Array.from({ length: 7 }, () => ({ start: "14:00", end: "18:00" })) },
    });

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.95 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("not_scheduled");
    expect(preview.exam_name).toBe("Prelim 2");
    // 95% gives days 3 and 6: Oct 18 fits, Oct 21 falls after the exam on Oct 19.
    expect(preview.items.map((i) => i.date)).toEqual(["2026-10-18"]);
    expect(preview.items[0].at).toBe("2026-10-18T18:00:00.000Z");
    expect(preview.skipped.map((i) => i.date)).toEqual(["2026-10-21"]);
  });

  it("returns the sessions already in the plan, with links", async () => {
    db.session.findMany.mockResolvedValue([
      { sessionId: "fu-1", resources: { followup_of_run_id: "run-1", followup_days_from_now: 2 } },
    ]);
    db.studyPlanItem.findMany.mockResolvedValue([
      {
        sessionId: "fu-1",
        startTime: new Date("2026-10-17T13:00:00Z"),
        plan: { timezone: "America/New_York", examName: "Prelim 2" },
      },
    ]);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.8 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("scheduled");
    expect(preview.items).toEqual([
      { date: "2026-10-17", at: "2026-10-17T13:00:00.000Z", days_from_now: 2, session_id: "fu-1" },
    ]);
    expect(db.studyPlan.findFirst).not.toHaveBeenCalled();
  });
});

describe("getSessionResults", () => {
  function completedRun(overrides: Record<string, unknown> = {}) {
    return {
      runId: "run-1",
      sessionId: "sess-1",
      userId: USER,
      status: "COMPLETED",
      mode: "RETRIEVAL",
      metrics: {
        attempts_count: 3,
        correct_count: 2,
        partial_count: 0,
        incorrect_count: 1,
        accuracy: 2 / 3,
        time_spent_seconds: 95,
        pretest_count: 1,
      },
      prompts: [],
      answeredCount: null,
      scoredCount: null,
      startedAt: new Date("2026-10-15T18:40:00Z"),
      endedAt: ENDED_AT,
      session: { courseName: "INFO 1300" },
      attempts: [
        { promptIndex: 0, selfScore: "INCORRECT", confidenceRating: 1 },
        { promptIndex: 1, selfScore: "CORRECT", confidenceRating: 5 },
        { promptIndex: 2, selfScore: "INCORRECT", confidenceRating: 5 },
        { promptIndex: 3, selfScore: "CORRECT", confidenceRating: null },
      ],
      runPrompts: [
        { promptIndex: 0, sourceType: "GENERATED", meta: { pack: "PRE_TEST" } },
        { promptIndex: 1, sourceType: "GENERATED", meta: null },
        { promptIndex: 2, sourceType: "ERROR_LOG", meta: { pack: "CROSS_SESSION_REPAIR" } },
        { promptIndex: 3, sourceType: "GENERATED", meta: { pack: "WARMUP" } },
      ],
      _count: { errorLogs: 1 },
      ...overrides,
    };
  }

  it("leaves pretest answers out of the rated answers and counts repairs", async () => {
    db.sessionRun.findUnique.mockResolvedValue(completedRun());
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findFirst.mockResolvedValue(null);

    const result = await getSessionResults(USER, "sess-1", "run-1");
    if ("error" in result) throw new Error(result.error);

    expect(result.data.question_count).toBe(4);
    expect(result.data.pretest_count).toBe(1);
    expect(result.data.repair_count).toBe(1);
    expect(result.data.errors_logged).toBe(1);
    expect(result.data.answers.map((a) => a.prompt_index)).toEqual([1, 2, 3]);
    expect(result.data.followups?.status).toBe("no_plan");
  });

  it("keeps exam simulation counts", async () => {
    db.sessionRun.findUnique.mockResolvedValue(
      completedRun({ mode: "EXAM_SIM", answeredCount: 4, scoredCount: 4 }),
    );
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findFirst.mockResolvedValue(null);

    const result = await getSessionResults(USER, "sess-1", "run-1");
    if ("error" in result) throw new Error(result.error);
    expect(result.data.answered_count).toBe(4);
    expect(result.data.scored_count).toBe(4);
  });

  it("refuses other students, other sessions and open runs", async () => {
    db.sessionRun.findUnique.mockResolvedValue(completedRun({ userId: "someone-else" }));
    expect(await getSessionResults(USER, "sess-1", "run-1")).toEqual({ error: "forbidden" });

    db.sessionRun.findUnique.mockResolvedValue(completedRun());
    expect(await getSessionResults(USER, "another-session", "run-1")).toEqual({ error: "not_found" });

    db.sessionRun.findUnique.mockResolvedValue(completedRun({ status: "ACTIVE" }));
    expect(await getSessionResults(USER, "sess-1", "run-1")).toEqual({ error: "not_completed" });

    db.sessionRun.findUnique.mockResolvedValue(null);
    expect(await getSessionResults(USER, "sess-1", "run-1")).toEqual({ error: "not_found" });
  });

  it("skips follow-ups when no answer counted", async () => {
    db.sessionRun.findUnique.mockResolvedValue(
      completedRun({ metrics: { attempts_count: 0, correct_count: 0, partial_count: 0, incorrect_count: 0, accuracy: 0, time_spent_seconds: 0 } }),
    );
    const result = await getSessionResults(USER, "sess-1", "run-1");
    if ("error" in result) throw new Error(result.error);
    expect(result.data.followups).toBeNull();
    expect(db.studyPlan.findFirst).not.toHaveBeenCalled();
  });
});

describe("compositionFromDeck", () => {
  it("reads an open run's deck the way the preview predicts it", () => {
    const deck = [
      { meta: { pack: "PRE_TEST" } },
      { meta: { pack: "WARMUP" } },
      { meta: { pack: "CROSS_SESSION_REPAIR" } },
      { meta: { source_error_log_id: "err-1" } },
      { meta: {} },
      {},
    ];
    expect(compositionFromDeck(deck, 6)).toEqual({
      total: 6,
      new_count: 2,
      diagnostic_count: 1,
      review_count: 1,
      repair_count: 2,
    });
  });

  it("copes with a missing deck", () => {
    expect(compositionFromDeck(null, 8)).toEqual({
      total: 8,
      new_count: 8,
      diagnostic_count: 0,
      review_count: 0,
      repair_count: 0,
    });
  });
});
