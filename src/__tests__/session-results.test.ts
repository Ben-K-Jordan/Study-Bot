import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The end screen's data: follow-up dates from the scheduler (anchored to
 * when the run ended, so they don't drift after a reload), honest counts
 * (pretest and repair questions), and owner checks. Prisma is mocked.
 */
const db = vi.hoisted(() => ({
  session: { findMany: vi.fn(), findUnique: vi.fn() },
  sessionRun: { findUnique: vi.fn(), findFirst: vi.fn() },
  studyPlan: { findMany: vi.fn() },
  studyPlanItem: { findMany: vi.fn(), findFirst: vi.fn() },
  userGameState: { findUnique: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: db }));
const run = vi.hoisted(() => ({ getDeckPreview: vi.fn() }));
vi.mock("@/services/run", () => run);

import {
  compositionFromDeck,
  findFollowupPlan,
  getFollowupPreview,
  getSessionDeckPreview,
  getSessionResults,
  getSessionScreen,
} from "@/services/session";

const USER = "user-1";
// 2026-10-15 19:00 UTC = 3:00 PM in New York
const ENDED_AT = new Date("2026-10-15T19:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  // Which follow-up days can still be added depends on the current time.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(ENDED_AT);
  db.userGameState.findUnique.mockResolvedValue({ timezone: "America/New_York" });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getFollowupPreview", () => {
  it("recommends days in the student's zone when there is no plan", async () => {
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findMany.mockResolvedValue([]);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.5 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("no_plan");
    expect(preview.plan_id).toBeNull();
    expect(preview.timezone).toBe("America/New_York");
    // Accuracy under 70% brings follow-ups 1 and 2 days after the run ended.
    expect(preview.items.map((i) => i.date)).toEqual(["2026-10-16", "2026-10-17"]);
    expect(preview.items[0].at).toBe("2026-10-16T16:00:00.000Z");
  });

  it("uses the scheduler's plan dates and skips days after the exam", async () => {
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findMany.mockResolvedValue([
      {
        planId: "plan-1",
        examName: "Prelim 2",
        examDate: new Date("2026-10-19T00:00:00Z"),
        startDate: new Date("2026-10-10T00:00:00Z"),
        timezone: "America/New_York",
        config: { availability: Array.from({ length: 7 }, () => ({ start: "14:00", end: "18:00" })) },
      },
    ]);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.95 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("not_scheduled");
    expect(preview.exam_name).toBe("Prelim 2");
    // "Open plan" links to the plan the follow-ups would go into.
    expect(preview.plan_id).toBe("plan-1");
    // 95% gives days 3 and 6: Oct 18 fits, Oct 21 falls after the exam on Oct 19.
    expect(preview.items.map((i) => i.date)).toEqual(["2026-10-18"]);
    expect(preview.items[0].at).toBe("2026-10-18T18:00:00.000Z");
    expect(preview.skipped.map((i) => i.date)).toEqual(["2026-10-21"]);
  });

  it("sends instants, not UTC days, when there is no zone and no plan", async () => {
    db.session.findMany.mockResolvedValue([]);
    db.studyPlan.findMany.mockResolvedValue([]);
    // 9:30 PM in New York is already the next day in UTC.
    const lateEvening = new Date("2026-10-16T01:30:00Z");

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: lateEvening, accuracy: 0.5 },
      "INFO 1300",
      null,
    );

    expect(preview.timezone).toBeNull();
    // The browser formats these in its own zone: Oct 16 and 17 in New York.
    expect(preview.items.map((i) => i.at)).toEqual(["2026-10-17T01:30:00.000Z", "2026-10-18T01:30:00.000Z"]);
  });

  it("reads the plan's start as the stored day, so per-day windows line up", async () => {
    db.session.findMany.mockResolvedValue([]);
    // Day i of the plan starts at 8 AM plus i hours, so each day has its own window.
    const availability = Array.from({ length: 14 }, (_, i) => ({
      start: `${String(8 + i).padStart(2, "0")}:00`,
      end: "22:00",
    }));
    db.studyPlan.findMany.mockResolvedValue([
      {
        planId: "plan-1",
        examName: "Prelim 2",
        examDate: new Date("2026-10-25T00:00:00Z"),
        startDate: new Date("2026-10-13T00:00:00Z"),
        timezone: "America/New_York",
        config: { availability },
      },
    ]);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.5 },
      "INFO 1300",
      "America/New_York",
    );

    // Oct 16 is day 3 of a plan that starts Oct 13: 11:00 AM in New York.
    // Reading the start through the zone gave Oct 12, day 4 and 12:00 PM.
    expect(preview.items[0].date).toBe("2026-10-16");
    expect(preview.items[0].at).toBe("2026-10-16T15:00:00.000Z");
  });

  it("returns the sessions already in the plan, with links", async () => {
    db.session.findMany.mockResolvedValue([
      { sessionId: "fu-1", resources: { followup_of_run_id: "run-1", followup_days_from_now: 2 } },
    ]);
    db.studyPlanItem.findMany.mockResolvedValue([
      {
        sessionId: "fu-1",
        startTime: new Date("2026-10-17T13:00:00Z"),
        plan: { planId: "plan-1", timezone: "America/New_York", examName: "Prelim 2" },
      },
    ]);

    const preview = await getFollowupPreview(
      USER,
      { runId: "run-1", endedAt: ENDED_AT, accuracy: 0.8 },
      "INFO 1300",
      "America/New_York",
    );

    expect(preview.status).toBe("scheduled");
    // A reload still links "Open plan" to the plan that holds them.
    expect(preview.plan_id).toBe("plan-1");
    expect(preview.items).toEqual([
      { date: "2026-10-17", at: "2026-10-17T13:00:00.000Z", days_from_now: 2, session_id: "fu-1" },
    ]);
    expect(db.studyPlan.findMany).not.toHaveBeenCalled();
  });
});

describe("findFollowupPlan", () => {
  const plan = (id: string, examDay: string, timezone: string) => ({
    planId: id,
    examDate: new Date(`${examDay}T00:00:00Z`),
    timezone,
  });

  it("keeps a plan whose exam is today in the plan's zone", async () => {
    // 10 PM on Oct 15 in New York, already Oct 16 in UTC.
    const now = new Date("2026-10-16T02:00:00Z");
    db.studyPlan.findMany.mockResolvedValue([
      plan("today", "2026-10-15", "America/New_York"),
      plan("later", "2026-10-30", "America/New_York"),
    ]);

    expect((await findFollowupPlan(USER, "INFO 1300", now))?.planId).toBe("today");
    // The query reaches back one UTC day, the earliest "today" in any zone.
    expect(db.studyPlan.findMany.mock.calls[0][0].where.examDate.gte).toEqual(new Date("2026-10-15T00:00:00Z"));
  });

  it("skips a plan whose exam day has passed in its zone", async () => {
    const now = new Date("2026-10-16T02:00:00Z");
    db.studyPlan.findMany.mockResolvedValue([
      plan("past", "2026-10-15", "Europe/London"),
      plan("later", "2026-10-30", "Europe/London"),
    ]);

    expect((await findFollowupPlan(USER, "INFO 1300", now))?.planId).toBe("later");
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
    db.studyPlan.findMany.mockResolvedValue([]);

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
    db.studyPlan.findMany.mockResolvedValue([]);

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
    expect(db.studyPlan.findMany).not.toHaveBeenCalled();
  });
});

describe("deck preview", () => {
  const session = {
    sessionId: "sess-1",
    userId: USER,
    courseName: "INFO 1300",
    examName: "Prelim 2",
    mode: "RETRIEVAL",
    topicScope: "Forms",
    plannedMinutes: 30,
    targetOutcome: { prompt_count: 6 },
    breakProtocol: null,
    objectives: null,
    runs: [],
  };
  const composition = { total: 6, new_count: 6, diagnostic_count: 0, review_count: 0, repair_count: 0 };

  it("is skipped when the page opens on results", async () => {
    db.session.findUnique.mockResolvedValue(session);
    db.sessionRun.findFirst.mockResolvedValue({ runId: "run-1", metrics: {}, endedAt: ENDED_AT });
    db.studyPlanItem.findFirst.mockResolvedValue(null);
    db.sessionRun.findUnique.mockResolvedValue(null);

    const screen = await getSessionScreen(USER, "sess-1");
    if ("error" in screen) throw new Error(screen.error);
    expect(await screen.data.deckPreview).toBeNull();
    expect(run.getDeckPreview).not.toHaveBeenCalled();
  });

  it("is predicted when the page opens on the intro", async () => {
    db.session.findUnique.mockResolvedValue(session);
    db.sessionRun.findFirst.mockResolvedValue(null);
    db.studyPlanItem.findFirst.mockResolvedValue(null);
    run.getDeckPreview.mockResolvedValue(composition);

    const screen = await getSessionScreen(USER, "sess-1");
    if ("error" in screen) throw new Error(screen.error);
    expect(await screen.data.deckPreview).toEqual(composition);
    expect(run.getDeckPreview).toHaveBeenCalledWith(USER, expect.objectContaining({ promptCount: 6 }));
  });

  it("loads on its own for the owner only", async () => {
    db.session.findUnique.mockResolvedValue(session);
    run.getDeckPreview.mockResolvedValue(composition);
    expect(await getSessionDeckPreview(USER, "sess-1")).toEqual({ data: composition });

    db.session.findUnique.mockResolvedValue({ ...session, userId: "someone-else" });
    expect(await getSessionDeckPreview(USER, "sess-1")).toEqual({ error: "not_found" });
  });

  it("reads an open run's deck instead of predicting", async () => {
    db.session.findUnique.mockResolvedValue({
      ...session,
      runs: [{ prompts: [{ meta: { pack: "PRE_TEST" } }, {}], promptCount: 2 }],
    });
    expect(await getSessionDeckPreview(USER, "sess-1")).toEqual({
      data: { total: 2, new_count: 1, diagnostic_count: 1, review_count: 0, repair_count: 0 },
    });
    expect(run.getDeckPreview).not.toHaveBeenCalled();
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
