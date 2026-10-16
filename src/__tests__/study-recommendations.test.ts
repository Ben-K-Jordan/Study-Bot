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
  sessionId: string;
  status: string;
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
  /** Session runs in any status; the service asks for the ones under way. */
  runs: RunRow[];
  gameState: { row: { timezone: string | null } | null };
  errors: { runId: string; promptIndex: number; errorType: string }[];
  plan: PlanRow | null;
  /** More plans for the same course (other exams). */
  otherPlans: PlanRow[];
  sessions: { objectives: unknown }[];
  nudgeSessions: { sessionId: string; mode: string; topicScope: string; objectives?: unknown }[];
  prompts: { runId: string; promptIndex: number; objectiveId: string | null }[];
  docs: { examName: string | null; status: string }[];
  existingSession: { sessionId: string } | null;
  plannedItem: { id: string } | null;
}

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const state: TestState = {
    runs: [],
    gameState: { row: null },
    errors: [],
    plan: null,
    otherPlans: [],
    sessions: [],
    nudgeSessions: [],
    prompts: [],
    docs: [],
    existingSession: null,
    plannedItem: null,
  };

  return {
    prisma: {
      sessionRun: {
        findMany: vi.fn(
          async (args: { where?: { sessionId?: { in?: string[] }; status?: { in?: string[] } } }) =>
            state.runs.filter(
              (run) =>
                (!args?.where?.sessionId?.in || args.where.sessionId.in.includes(run.sessionId)) &&
                (!args?.where?.status?.in || args.where.status.in.includes(run.status)),
            ),
        ),
      },
      sessionErrorLog: { findMany: vi.fn(async () => state.errors) },
      // Plans whose exam is today or later, nearest exam first (findActivePlan).
      studyPlan: {
        findMany: vi.fn(async (args: { where?: { examDate?: { gte?: Date } } }) => {
          const from = args?.where?.examDate?.gte ?? new Date(0);
          return [...(state.plan ? [state.plan] : []), ...state.otherPlans]
            .filter((p) => p.examDate >= from)
            .sort((a, b) => a.examDate.getTime() - b.examDate.getTime());
        }),
      },
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

// The streak and the zone come from gamification (covered in gamification.test.ts)
vi.mock("@/services/gamification", () => ({
  getStreak: vi.fn(async () => 0),
  resolveTimeZone: vi.fn(async () => "UTC"),
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
  errorRepairReason,
  getStudyRecommendations,
  readableTopicScope,
  sessionTopicLine,
  startStudySession,
  StudyStartError,
} from "@/services/study-recommendations";
import { humanizeObjectiveKey } from "@/lib/objective-keys";
import { prisma } from "@/lib/db";
import { getDueObjectives, getMasterySummary } from "@/lib/mastery";
import { createSession } from "@/services/session";
import { getStreak, resolveTimeZone } from "@/services/gamification";

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
  state.runs = [];
  state.gameState.row = null;
  state.errors = [];
  state.plan = null;
  state.otherPlans = [];
  state.sessions = [];
  state.nudgeSessions = [];
  state.prompts = [];
  state.docs = [];
  state.existingSession = null;
  state.plannedItem = null;
  vi.mocked(getDueObjectives).mockResolvedValue([]);
  setMastery([]);
  // Settings, else the newest plan's zone, else UTC, as resolveTimeZone does.
  vi.mocked(resolveTimeZone).mockImplementation(
    async () => state.gameState.row?.timezone ?? state.plan?.timezone ?? "UTC",
  );
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
    expect(humanizeObjectiveKey("photosynthesis_light_reactions")).toBe("Photosynthesis light reactions");
    expect(humanizeObjectiveKey("big-o")).toBe("Big o");
    expect(humanizeObjectiveKey("__")).toBe("Untitled topic");
  });

  it("joins up to three titles and counts the rest", () => {
    expect(buildTopicScope([])).toBe("General review");
    expect(buildTopicScope(["Specificity"])).toBe("Specificity");
    expect(buildTopicScope(["A", "B", "C"])).toBe("A, B, and C");
    expect(buildTopicScope(["A", "B", "C", "D", "E"])).toBe("A, B, C, and 2 more");
  });

  it("rewrites stored key scopes as one list", () => {
    const titles = new Map([["css_specificity", "CSS specificity"]]);
    expect(readableTopicScope("css_specificity, box_model (+2 more)", titles)).toBe(
      "CSS specificity, Box model, and 2 more",
    );
    expect(readableTopicScope("", titles)).toBe("General review");
  });

  it("lists comma-joined titles the way Home and Plan do", () => {
    const titles = new Map<string, string>();
    // Plans store titles joined with ", " (research-plan-generator).
    expect(readableTopicScope("CSS specificity, The box model", titles)).toBe("CSS specificity and The box model");
    expect(readableTopicScope("Specificity, Box sizing, Flexbox", titles)).toBe(
      "Specificity, Box sizing, and Flexbox",
    );
    // Already a list, or a single title: unchanged.
    expect(readableTopicScope("A, B, and C", titles)).toBe("A, B, and C");
    expect(readableTopicScope("Recursion and stacks", titles)).toBe("Recursion and stacks");
    expect(readableTopicScope("Big-O", titles)).toBe("Big-O");
  });

  it("prefers the titles stored on the session", () => {
    const titles = new Map([["cell_cycle", "Cell cycle"]]);
    expect(
      sessionTopicLine(
        [
          { id: "css_specificity", title: "CSS specificity" },
          { id: "box_model", title: "The box model" },
        ],
        "css_specificity, box_model",
        titles,
      ),
    ).toBe("CSS specificity and The box model");
    expect(sessionTopicLine([{ id: "cell_cycle", title: "cell_cycle" }], "", titles)).toBe("Cell cycle");
    expect(sessionTopicLine(["Recursion", "Stacks"], "", titles)).toBe("Recursion and Stacks");
    expect(sessionTopicLine(null, "Recursion, Stacks", titles)).toBe("Recursion and Stacks");
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
    // For the card, whose heading line already gives the count.
    expect(recs.next_session.reason_without_count).toBe(
      "Most are misconceptions. An error is resolved after you answer it correctly on 2 different days.",
    );
    expect(recs.unresolved_errors.count).toBe(4);
  });

  it("can leave the count out of the error repair reason", () => {
    const rule = "An error is resolved after you answer it correctly on 2 different days.";
    expect(errorRepairReason(["MEMORY", "MEMORY", "MEMORY"], { withCount: false })).toBe(`All are memory gaps. ${rule}`);
    expect(errorRepairReason(["PROCEDURE", "PROCEDURE", "CARELESS"], { withCount: false })).toBe(
      `Most are wrong steps. ${rule}`,
    );
    expect(errorRepairReason(["CARELESS", "PROCEDURE", "MEMORY"], { withCount: false })).toBe(rule);
    expect(errorRepairReason(["MEMORY"], { withCount: false })).toBe(rule);
  });

  it("keeps the same reason with and without a count for other modes", async () => {
    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_session.reason_without_count).toBe(recs.next_session.reason);
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
    // Today had a session and it is done, so Study says so instead of "none today".
    expect(recs.today_planned).toBe(1);
    expect(recs.today_done).toBe(1);
  });

  it("counts today's sessions in every status, so none planned differs from none left", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = planWith([
      // 10am Jul 15 in New York: today, missed
      {
        sessionId: "s-missed",
        status: "MISSED",
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
    state.nudgeSessions = [{ sessionId: "s-later", mode: "RETRIEVAL", topicScope: "Cell cycle" }];

    const missed = await getStudyRecommendations("user1", "Biology");
    expect(missed.plan_nudge).toBeNull();
    expect(missed.next_planned?.session_id).toBe("s-later");
    expect([missed.today_planned, missed.today_done]).toEqual([1, 0]);

    // Nothing on today's date at all.
    state.plan = planWith(state.plan.items.filter((i) => i.sessionId === "s-later"));
    const none = await getStudyRecommendations("user1", "Biology");
    expect(none.next_planned?.session_id).toBe("s-later");
    expect([none.today_planned, none.today_done]).toEqual([0, 0]);
  });

  it("lists a planned session's topics with Intl, as Home and Plan do", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = planWith([
      {
        sessionId: "s-today",
        status: "SCHEDULED",
        dayIndex: 0,
        startTime: new Date("2026-07-15T18:00:00Z"),
        endTime: new Date("2026-07-15T18:30:00Z"),
      },
    ]);
    // A plan session: titles comma-joined in the scope, objectives stored too.
    state.nudgeSessions = [
      {
        sessionId: "s-today",
        mode: "RETRIEVAL",
        topicScope: "CSS specificity, The box model",
        objectives: [
          { id: "css_specificity", title: "CSS specificity" },
          { id: "the_box_model", title: "The box model" },
        ],
      },
    ];

    const recs = await getStudyRecommendations("user1", "INFO 1300");
    const item = recs.plan_nudge!.items[0];
    expect(item.topic_scope).toBe("CSS specificity and The box model");
    expect(item.message).toMatch(/^Today at 2:00\sPM: Retrieval on CSS specificity and The box model$/);
  });

  it("counts rescheduled sessions as still to do", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = planWith([
      {
        sessionId: "s-moved",
        status: "RESCHEDULED",
        dayIndex: 3,
        startTime: new Date("2026-07-18T14:00:00Z"),
        endTime: new Date("2026-07-18T14:30:00Z"),
      },
    ]);
    state.nudgeSessions = [{ sessionId: "s-moved", mode: "RETRIEVAL", topicScope: "Cell cycle" }];

    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.next_planned?.session_id).toBe("s-moved");
  });

  it("marks a session with a run under way IN_PROGRESS, so Study offers Resume session as Home does", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    const today = (sessionId: string, hour: number, status = "SCHEDULED"): PlanItemRow => ({
      sessionId,
      status,
      dayIndex: 0,
      startTime: new Date(`2026-07-15T${hour}:00:00Z`),
      endTime: new Date(`2026-07-15T${hour}:30:00Z`),
    });
    state.plan = planWith([
      today("s-started", 14),
      // Missed, then opened from its link and started: resumable, as on Home
      today("s-missed", 15, "MISSED"),
      today("s-done", 16, "DONE"),
      today("s-open", 17),
    ]);
    state.nudgeSessions = ["s-started", "s-missed", "s-open"].map((sessionId) => ({
      sessionId,
      mode: "RETRIEVAL",
      topicScope: "Cell cycle",
    }));
    // Starting a run doesn't write the plan item; the runs say what is under way.
    state.runs = [
      { sessionId: "s-started", status: "ACTIVE" },
      { sessionId: "s-missed", status: "PAUSED" },
      // A finished session's later run doesn't reopen it.
      { sessionId: "s-done", status: "ACTIVE" },
      { sessionId: "s-open", status: "COMPLETED" },
      { sessionId: "s-elsewhere", status: "ACTIVE" },
    ];

    const recs = await getStudyRecommendations("user1", "Biology");
    expect(recs.plan_nudge?.items.map((i) => [i.session_id, i.status])).toEqual([
      ["s-started", "IN_PROGRESS"],
      ["s-missed", "IN_PROGRESS"],
      ["s-open", "SCHEDULED"],
    ]);
    expect([recs.today_planned, recs.today_done]).toEqual([4, 1]);
    // Only the plan's own sessions are looked up, by the statuses Home and Plan count.
    expect(vi.mocked(prisma.sessionRun.findMany)).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        sessionId: { in: ["s-started", "s-missed", "s-done", "s-open"] },
        status: { in: ["ACTIVE", "PAUSED"] },
      },
      select: { sessionId: true },
    });
  });

  it("skips the run lookup when the course has no plan", async () => {
    await getStudyRecommendations("user1", "Biology");
    expect(vi.mocked(prisma.sessionRun.findMany)).not.toHaveBeenCalled();
  });
});

describe("the course's exam", () => {
  function plan(planId: string, examName: string, examDate: string): PlanRow {
    return {
      planId,
      examName,
      examDate: new Date(`${examDate}T00:00:00Z`),
      timezone: "America/New_York",
      config: {},
      items: [],
    };
  }

  it("uses the plan for the exam chosen in the course switcher", async () => {
    state.plan = plan("p1", "Prelim 1", "2026-07-20");
    state.otherPlans = [plan("p2", "Prelim 2", "2026-08-10")];

    expect((await getStudyRecommendations("user1", "CS 2110", "Prelim 2")).exam?.name).toBe("Prelim 2");
    // No exam chosen, or one without a plan: the nearest exam ahead.
    expect((await getStudyRecommendations("user1", "CS 2110")).exam?.name).toBe("Prelim 1");
    expect((await getStudyRecommendations("user1", "CS 2110", "Final")).exam?.name).toBe("Prelim 1");
  });

  it("drops a plan once its exam has passed, and keeps one whose exam is today", async () => {
    state.gameState.row = { timezone: "America/New_York" };
    state.plan = plan("old", "Prelim 1", "2026-07-14");
    expect((await getStudyRecommendations("user1", "CS 2110")).exam).toBeNull();

    state.plan = plan("today", "Prelim 1", "2026-07-15");
    expect((await getStudyRecommendations("user1", "CS 2110")).exam).toEqual({
      name: "Prelim 1",
      date: "2026-07-15",
      days_until: 0,
    });
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
