/**
 * Unit tests for the study recommendations service: the streak, the
 * recommended session (mode, topic titles, reason copy), planned sessions
 * in the student's time zone, and starting a session from the Study screen.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Run under a positive UTC offset so local-midnight bugs would surface:
// at the fixed test time (2026-07-15T10:00:00Z) local Tokyo time is 19:00,
// but local midnight serializes to the PREVIOUS UTC day.
process.env.TZ = "Asia/Tokyo";

interface RunRow {
  endedAt: Date | null;
}

interface PlanItemRow {
  sessionId: string;
  status: string;
  dayIndex: number;
  startTime: Date;
  endTime: Date;
}

interface PlanRow {
  planId: string;
  examName: string;
  examDate: Date;
  timezone: string;
  config: unknown;
  items: PlanItemRow[];
}

interface TestState {
  completedRuns: RunRow[];
  gameState: { row: { timezone: string | null } | null };
  errors: { runId: string; promptIndex: number; errorType: string }[];
  plan: PlanRow | null;
  sessions: { objectives: unknown }[];
  nudgeSessions: { sessionId: string; mode: string; topicScope: string }[];
  prompts: { runId: string; promptIndex: number; objectiveId: string | null }[];
  docs: { examName: string | null; status: string }[];
  existingSession: { sessionId: string } | null;
  plannedItem: { id: string } | null;
}

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const state: TestState = {
    completedRuns: [],
    gameState: { row: null },
    errors: [],
    plan: null,
    sessions: [],
    nudgeSessions: [],
    prompts: [],
    docs: [],
    existingSession: null,
    plannedItem: null,
  };

  return {
    prisma: {
      sessionRun: { findMany: vi.fn(async () => state.completedRuns) },
      sessionErrorLog: { findMany: vi.fn(async () => state.errors) },
      studyPlan: { findFirst: vi.fn(async () => state.plan) },
      // getUserTimezone reads UserGameState.timezone; null row = no timezone (UTC)
      userGameState: { findUnique: vi.fn(async () => state.gameState.row) },
      session: {
        findMany: vi.fn(async (args: { where?: { sessionId?: unknown } }) =>
          args?.where?.sessionId ? state.nudgeSessions : state.sessions,
        ),
        findFirst: vi.fn(async () => state.existingSession),
      },
      sessionRunPrompt: { findMany: vi.fn(async () => state.prompts) },
      contentDocument: { findMany: vi.fn(async () => state.docs) },
      studyPlanItem: { findFirst: vi.fn(async () => state.plannedItem) },
      _test: state,
    },
  };
});

vi.mock("@/lib/mastery", () => ({
  getDueObjectives: vi.fn(async () => []),
  getMasterySummary: vi.fn(async () => ({ total: 0, objectives: [] })),
}));

// The streak comes from gamification (covered in gamification.test.ts)
vi.mock("@/services/gamification", () => ({
  getStreak: vi.fn(async () => 0),
}));

vi.mock("@/services/session", () => ({
  createSession: vi.fn(async () => ({
    session_id: "new-session",
    session_url: "http://elsewhere.example/s/new-session",
    calendar: { title: "", description: "" },
  })),
}));

import {
  buildTopicScope,
  dominantErrorPhrase,
  getStudyRecommendations,
  humanizeTopicKey,
  readableTopicScope,
  startStudySession,
  StudyStartError,
} from "@/services/study-recommendations";
import { prisma } from "@/lib/db";
import { getDueObjectives, getMasterySummary } from "@/lib/mastery";
import { createSession } from "@/services/session";
import { getStreak } from "@/services/gamification";

const state = (prisma as unknown as { _test: TestState })._test;

const NOW = new Date("2026-07-15T10:00:00Z"); // UTC day 2026-07-15, Tokyo 19:00

type MasteryRow = {
  objective_key: string;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_accuracy: number | null;
  last_studied_at: string | null;
  next_due_at: string | null;
  is_due: boolean;
};

function mastery(key: string, repetitions: number, lastAccuracy: number | null): MasteryRow {
  return {
    objective_key: key,
    ease_factor: 2.5,
    interval_days: 1,
    repetitions,
    last_accuracy: lastAccuracy,
    last_studied_at: null,
    next_due_at: null,
    is_due: false,
  };
}

function setMastery(rows: MasteryRow[]) {
  vi.mocked(getMasterySummary).mockResolvedValue({
    total: rows.length,
    due: 0,
    mastered: 0,
    objectives: rows,
  });
}

function setDue(rows: { key: string; daysOverdue: number }[]) {
  vi.mocked(getDueObjectives).mockResolvedValue(
    rows.map((r) => ({
      id: r.key,
      userId: "user1",
      courseName: "Biology",
      objectiveKey: r.key,
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      lastAccuracy: 0.5,
      lastStudiedAt: null,
      nextDueAt: new Date(NOW.getTime() - r.daysOverdue * 86_400_000 - 3_600_000),
      updatedAt: NOW,
    })),
  );
}

async function getStreak_(): Promise<number> {
  const result = await getStudyRecommendations("user1", "Biology");
  return result.streak;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  state.completedRuns.length = 0;
  state.gameState.row = null;
  state.errors = [];
  state.plan = null;
  state.sessions = [];
  state.nudgeSessions = [];
  state.prompts = [];
  state.docs = [];
  state.existingSession = null;
  state.plannedItem = null;
  vi.mocked(getDueObjectives).mockResolvedValue([]);
  setMastery([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("streak", () => {
  it("shows the same streak as Home and Progress", async () => {
    vi.mocked(getStreak).mockResolvedValueOnce(4);
    expect(await getStreak_()).toBe(4);
    expect(getStreak).toHaveBeenCalledWith("user1");
  });

  it("is 0 when the student has no streak", async () => {
    expect(await getStreak_()).toBe(0);
  });
});

describe("topic titles", () => {
  it("humanizes keys", () => {
    expect(humanizeTopicKey("photosynthesis_light_reactions")).toBe("Photosynthesis light reactions");
    expect(humanizeTopicKey("big-o")).toBe("Big o");
    expect(humanizeTopicKey("__")).toBe("Untitled topic");
  });

  it("joins up to three titles and counts the rest", () => {
    expect(buildTopicScope([])).toBe("General review");
    expect(buildTopicScope(["Specificity"])).toBe("Specificity");
    expect(buildTopicScope(["A", "B", "C"])).toBe("A, B, and C");
    expect(buildTopicScope(["A", "B", "C", "D", "E"])).toBe("A, B, C, and 2 more");
  });

  it("rewrites stored key scopes and leaves titles alone", () => {
    const titles = new Map([["css_specificity", "CSS specificity"]]);
    expect(readableTopicScope("css_specificity, box_model (+2 more)", titles)).toBe(
      "CSS specificity, Box model, and 2 more",
    );
    expect(readableTopicScope("Specificity, Box sizing", titles)).toBe("Specificity, Box sizing");
  });

  it("maps mastery keys to plan and session titles in the recommendation", async () => {
    state.plan = {
      planId: "plan1",
      examName: "Prelim 1",
      examDate: new Date("2026-07-30T00:00:00Z"),
      timezone: "America/New_York",
      config: { objectives: ["CSS specificity", "Box model"] },
      items: [],
    };
    state.sessions = [{ objectives: [{ id: "flexbox_axes", title: "Flexbox axes" }] }];
    setMastery([
      mastery("css_specificity", 0, null),
      mastery("flexbox_axes", 1, 0.4),
      mastery("grid_template_areas", 2, 0.6),
    ]);

    const recs = await getStudyRecommendations("user1", "INFO 1300");
    expect(recs.next_session.mode).toBe("RETRIEVAL");
    expect(recs.next_session.topics).toEqual([
      { key: "css_specificity", title: "CSS specificity" },
      { key: "flexbox_axes", title: "Flexbox axes" },
      { key: "grid_template_areas", title: "Grid template areas" },
    ]);
    expect(recs.next_session.objectives).toEqual(["css_specificity", "flexbox_axes", "grid_template_areas"]);
    expect(recs.next_session.topic_scope).toBe("CSS specificity, Flexbox axes, and Grid template areas");
    expect(recs.exam).toEqual({ name: "Prelim 1", date: "2026-07-30", days_until: 15 });
  });
});

describe("recommendation reasons", () => {
  it("recommends error repair with the topics the errors came from", async () => {
    state.errors = [
      { runId: "r1", promptIndex: 0, errorType: "MISCONCEPTION" },
      { runId: "r1", promptIndex: 1, errorType: "MISCONCEPTION" },
      { runId: "r2", promptIndex: 0, errorType: "PROCEDURE" },
      { runId: "r2", promptIndex: 3, errorType: "MISCONCEPTION" },
    ];
    state.prompts = [
      { runId: "r1", promptIndex: 0, objectiveId: "css_specificity" },
      { runId: "r1", promptIndex: 1, objectiveId: "css_specificity" },
      { runId: "r2", promptIndex: 0, objectiveId: "box_model" },
      { runId: "r2", promptIndex: 3, objectiveId: null },
    ];

    const recs = await getStudyRecommendations("user1", "INFO 1300");
    expect(recs.next_session.mode).toBe("ERROR_REPAIR");
    expect(recs.next_session.objectives).toEqual(["css_specificity", "box_model"]);
    expect(recs.next_session.reason).toBe(
      "4 unresolved errors, mostly misconceptions. An error is resolved after you answer it correctly on 2 different days.",
    );
    expect(recs.unresolved_errors.count).toBe(4);
  });

  it("names the dominant error type only when it is more than half", () => {
    expect(dominantErrorPhrase(["MEMORY", "MEMORY", "MEMORY"])).toBe("all memory gaps");
    expect(dominantErrorPhrase(["CARELESS", "PROCEDURE"])).toBeNull();
    expect(dominantErrorPhrase(["UNKNOWN", "UNKNOWN", "PROCEDURE"])).toBeNull();
  });

  it("recommends retrieval for overdue topics with the oldest delay", async () => {
    setDue([
      { key: "a_topic", daysOverdue: 4 },
      { key: "b_topic", daysOverdue: 2 },
      { key: "c_topic", daysOverdue: 1 },
      { key: "d_topic", daysOverdue: 0 },
      { key: "e_topic", daysOverdue: 0 },
      { key: "f_topic", daysOverdue: 0 },
    ]);
    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_session.mode).toBe("RETRIEVAL");
    expect(recs.next_session.reason).toBe("6 topics are due for review, the oldest by 4 days.");
    expect(recs.next_session.topic_scope).toBe("A topic, B topic, C topic, and 2 more");
  });

  it("recommends an exam simulation when the exam is 3 or fewer days away", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = {
      planId: "plan1",
      examName: "Prelim 1",
      examDate: new Date("2026-07-17T00:00:00Z"),
      timezone: "America/New_York",
      config: {},
      items: [],
    };
    setMastery([mastery("cell_cycle", 1, 0.5)]);
    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_session.mode).toBe("EXAM_SIM");
    expect(recs.next_session.reason).toBe(
      "Prelim 1 is in 2 days. A full practice exam now shows what you still miss while there's time to fix it.",
    );
  });

  it("recommends interleaved practice once every topic has been practiced", async () => {
    setMastery([mastery("a_topic", 2, 0.9), mastery("b_topic", 1, 0.8)]);
    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_session.mode).toBe("INTERLEAVED_PRACTICE");
    expect(recs.next_session.reason).toBe(
      "You've practiced every topic at least once. Mixing topics helps you tell similar problems apart.",
    );
  });

  it("says so plainly when there is no practice yet", async () => {
    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_session.topics).toEqual([]);
    expect(recs.next_session.topic_scope).toBe("General review");
    expect(recs.next_session.reason).toBe(
      "You haven't practiced Biology yet. A first session from memory shows where you stand.",
    );
  });

  it("never returns dashes, enum names or snake_case keys in visible text", async () => {
    state.errors = [
      { runId: "r1", promptIndex: 0, errorType: "PROCEDURE" },
      { runId: "r1", promptIndex: 1, errorType: "CARELESS" },
      { runId: "r1", promptIndex: 2, errorType: "MEMORY" },
    ];
    const recs = await getStudyRecommendations("user1", "Biology");
    const visible = [recs.next_session.reason, recs.next_session.topic_scope].join(" ");
    expect(visible).not.toMatch(/[–—]| -- /);
    expect(visible).not.toMatch(/\b[A-Z]{2,}_[A-Z_]+\b|\b[a-z]+_[a-z_]+\b/);
    expect(visible).not.toMatch(/research|robust/i);
  });
});

describe("planned sessions", () => {
  function planWith(items: PlanItemRow[]): PlanRow {
    return {
      planId: "plan1",
      examName: "Prelim 1",
      examDate: new Date("2026-08-01T00:00:00Z"),
      timezone: "America/New_York",
      config: {},
      items,
    };
  }

  it("finds today's sessions in the student's time zone and writes readable messages", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = planWith([
      // 11pm Jul 14 in New York: yesterday there
      {
        sessionId: "s-yesterday",
        status: "SCHEDULED",
        dayIndex: 0,
        startTime: new Date("2026-07-15T03:00:00Z"),
        endTime: new Date("2026-07-15T03:30:00Z"),
      },
      // 9pm Jul 15 in New York: today there, though it is Jul 16 in UTC
      {
        sessionId: "s-today",
        status: "SCHEDULED",
        dayIndex: 1,
        startTime: new Date("2026-07-16T01:00:00Z"),
        endTime: new Date("2026-07-16T01:30:00Z"),
      },
    ]);
    state.nudgeSessions = [
      { sessionId: "s-today", mode: "RETRIEVAL", topicScope: "photosynthesis_light_reactions" },
    ];

    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.plan_nudge?.items.map((i) => i.session_id)).toEqual(["s-today"]);
    const item = recs.plan_nudge!.items[0];
    expect(item.mode_label).toBe("Retrieval");
    expect(item.topic_scope).toBe("Photosynthesis light reactions");
    expect(item.message).toMatch(/^Today at 9:00\sPM: Retrieval on Photosynthesis light reactions$/);
    expect(recs.next_planned).toBeNull();
    expect(recs.time_zone).toBe("America/New_York");
  });

  it("offers the next planned session when none is left today", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = planWith([
      {
        sessionId: "s-done",
        status: "DONE",
        dayIndex: 0,
        startTime: new Date("2026-07-15T14:00:00Z"),
        endTime: new Date("2026-07-15T14:30:00Z"),
      },
      {
        sessionId: "s-later",
        status: "SCHEDULED",
        dayIndex: 2,
        startTime: new Date("2026-07-17T18:00:00Z"),
        endTime: new Date("2026-07-17T18:30:00Z"),
      },
    ]);
    state.nudgeSessions = [{ sessionId: "s-later", mode: "EXAM_SIM", topicScope: "Cell cycle" }];

    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.plan_nudge).toBeNull();
    expect(recs.next_planned?.session_id).toBe("s-later");
    expect(recs.next_planned?.mode_label).toBe("Exam simulation");
    expect(recs.next_planned?.message).toBe("Exam simulation on Cell cycle");
  });
});

describe("startStudySession", () => {
  beforeEach(() => {
    state.docs = [{ examName: "Prelim 1", status: "PROCESSED" }];
    setMastery([mastery("cell_cycle", 0, null)]);
  });

  it("creates a session with titled topics, a relative URL and a length-based question count", async () => {
    const result = await startStudySession("user1", { courseName: "Biology", mode: "RETRIEVAL", minutes: 30 });
    expect(result).toEqual({ session_id: "new-session", url: "/s/new-session", reused: false });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createSession).mock.calls[0][1]).toEqual({
      course_name: "Biology",
      exam_name: "Prelim 1",
      mode: "RETRIEVAL",
      topic_scope: "Cell cycle",
      planned_minutes: 30,
      objectives: [{ id: "cell_cycle", title: "Cell cycle" }],
      target_outcome: { prompt_count: 10 },
      break_protocol: { type: "50_10", cycles: 1 },
    });
  });

  it("uses the picked mode and length", async () => {
    await startStudySession("user1", { courseName: "Biology", examName: "Final", mode: "WORKED_EXAMPLES", minutes: 15 });
    const payload = vi.mocked(createSession).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.mode).toBe("WORKED_EXAMPLES");
    expect(payload.exam_name).toBe("Final");
    expect(payload.planned_minutes).toBe(15);
    expect(payload.target_outcome).toEqual({ prompt_count: 5 });
  });

  it("reuses an identical session that was never started", async () => {
    state.existingSession = { sessionId: "earlier" };
    const result = await startStudySession("user1", { courseName: "Biology", mode: "RETRIEVAL", minutes: 30 });
    expect(result).toEqual({ session_id: "earlier", url: "/s/earlier", reused: true });
    expect(createSession).not.toHaveBeenCalled();
  });

  it("never reuses a planned session", async () => {
    state.existingSession = { sessionId: "planned" };
    state.plannedItem = { id: "item1" };
    const result = await startStudySession("user1", { courseName: "Biology", mode: "RETRIEVAL", minutes: 30 });
    expect(result.session_id).toBe("new-session");
  });

  it("refuses a course with no materials or none ready", async () => {
    state.docs = [];
    await expect(
      startStudySession("user1", { courseName: "Biology", mode: "RETRIEVAL", minutes: 30 }),
    ).rejects.toMatchObject({ code: "COURSE_NOT_FOUND" });

    state.docs = [{ examName: null, status: "UPLOADED" }];
    const err = await startStudySession("user1", { courseName: "Biology", mode: "RETRIEVAL", minutes: 30 }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(StudyStartError);
    expect((err as StudyStartError).code).toBe("NO_MATERIALS");
    expect(createSession).not.toHaveBeenCalled();
  });
});
