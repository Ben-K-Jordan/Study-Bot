/**
 * Unit tests for feedback persistence and eager generation.
 *
 * - feedbackJson round-trip: elaborated AI feedback (Van der Kleij 2015,
 *   g = 0.49) is persisted on first generation and returned verbatim on
 *   refetch without re-running search or AI calls.
 * - Eager claim exclusivity: the atomic NONE -> GENERATING claim guarantees
 *   a concurrent GET and submit-path eager call never both generate.
 * - PENDING while GENERATING, stale-claim reclaim, and failure -> NONE reset.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// ---- Stateful prisma mock -------------------------------------------------

interface AttemptRow {
  id: string;
  runId: string;
  promptIndex: number;
  promptText: string;
  userAnswer: string;
  selfScore: string | null;
  confidenceRating: number | null;
  feedbackStatus: string;
  feedbackJson: Record<string, unknown> | null;
  run: {
    userId: string;
    session: {
      courseName: string;
      examName: string;
      objectives: { id: string; title: string }[];
    };
  };
}

const store: { row: AttemptRow | null } = { row: null };

vi.mock("@/lib/db", () => {
  const prisma = {
    sessionAttempt: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        store.row && store.row.id === where.id ? store.row : null,
      ),
      // Simulates the DB's atomic conditional update: the where clause is
      // evaluated against the current row state in one step.
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            id: string;
            feedbackStatus?: string;
            feedbackJson?: { path: string[]; equals: string };
          };
          data: Record<string, unknown>;
        }) => {
          const row = store.row;
          if (!row || row.id !== where.id) return { count: 0 };
          if (where.feedbackStatus !== undefined && row.feedbackStatus !== where.feedbackStatus) {
            return { count: 0 };
          }
          if (where.feedbackJson !== undefined) {
            const key = where.feedbackJson.path[0];
            const current = row.feedbackJson?.[key];
            if (current !== where.feedbackJson.equals) return { count: 0 };
          }
          Object.assign(row, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(
        async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          if (!store.row || store.row.id !== where.id) throw new Error("Record not found");
          Object.assign(store.row, data);
          return store.row;
        },
      ),
    },
    sessionErrorLog: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    sessionRunPrompt: { findUnique: vi.fn(async () => null) },
    objectiveAnchor: { findMany: vi.fn(async () => []) },
    attemptCitation: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma };
});

const SEARCH_RESULT = {
  chunk_id: "chunk-1",
  doc_id: "doc-1",
  doc_title: "Cell Biology Notes",
  page_number: 3,
  rank_score: 1.0,
  snippet: "Osmosis is the diffusion of water across a membrane.",
};

vi.mock("@/lib/search", () => ({
  searchChunks: vi.fn(async () => [SEARCH_RESULT]),
  buildFeedbackQuery: vi.fn(() => "query"),
}));

vi.mock("@/lib/ai/provider-factory", () => ({
  createProvider: vi.fn(() => ({})),
}));

vi.mock("@/lib/ai/gateway", () => ({
  runTask: vi.fn(async (_ctx: unknown, spec: { task: string }) => {
    if (spec.task === "GENERATE_FEEDBACK") {
      return {
        output: {
          explanation: "ai-explanation",
          key_takeaway: "ai-takeaway",
          concept_connection: null,
          mnemonic: null,
          pattern_advice: null,
          referenced_chunk_ids: [],
        },
      };
    }
    if (spec.task === "SOCRATIC_FOLLOWUP") {
      return { output: { followup_question: "Why does water move?", purpose: "probe" } };
    }
    if (spec.task === "REINFORCE_CORRECT") {
      return {
        output: { reinforcement: "well done", deeper_insight: "deeper", concept_connection: null },
      };
    }
    return { output: {} };
  }),
}));

import { generateFeedback, generateFeedbackEager } from "@/services/feedback";
import { prisma } from "@/lib/db";
import { searchChunks } from "@/lib/search";
import { runTask } from "@/lib/ai/gateway";

const updateManyMock = vi.mocked(prisma.sessionAttempt.updateMany);
const updateMock = vi.mocked(prisma.sessionAttempt.update);
const searchChunksMock = vi.mocked(searchChunks);
const runTaskMock = vi.mocked(runTask);

function makeAttempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: "attempt-1",
    runId: "run-1",
    promptIndex: 0,
    promptText: "What is osmosis?",
    userAnswer: "something wrong",
    selfScore: "INCORRECT",
    confidenceRating: 4,
    feedbackStatus: "NONE",
    feedbackJson: null,
    run: {
      userId: "user-1",
      session: {
        courseName: "Biology",
        examName: "Midterm 1",
        objectives: [{ id: "obj-1", title: "Cell transport" }],
      },
    },
    ...overrides,
  };
}

const ORIGINAL_AI_PROVIDER = process.env.AI_PROVIDER;

describe("feedback persistence and eager generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    store.row = makeAttempt();
    // Non-mock provider so the AI helpers actually call the (mocked) gateway
    process.env.AI_PROVIDER = "openai";
    // Restore the default search behavior (tests below override it)
    searchChunksMock.mockImplementation(async () => [SEARCH_RESULT]);
  });

  afterAll(() => {
    if (ORIGINAL_AI_PROVIDER === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = ORIGINAL_AI_PROVIDER;
  });

  describe("feedbackJson round-trip", () => {
    it("persists generated feedback as READY and returns the stored copy without AI calls", async () => {
      const first = await generateFeedback("user-1", "attempt-1");

      expect(first.status).toBe("OK");
      expect(first.explanation).toBe("ai-explanation");
      expect(first.socratic_followup).toBe("Why does water move?");
      expect(first.excerpts).toHaveLength(1);

      // Persisted: full FeedbackResponse stored, status READY
      expect(store.row?.feedbackStatus).toBe("READY");
      expect(store.row?.feedbackJson).toEqual(first);

      searchChunksMock.mockClear();
      runTaskMock.mockClear();
      updateManyMock.mockClear();
      updateMock.mockClear();

      const second = await generateFeedback("user-1", "attempt-1");

      // Verbatim round-trip — elaborated AI fields survive refetch
      expect(second).toEqual(first);
      // No regeneration: no search, no AI calls, no claim attempts
      expect(searchChunksMock).not.toHaveBeenCalled();
      expect(runTaskMock).not.toHaveBeenCalled();
      expect(updateManyMock).not.toHaveBeenCalled();
      expect(updateMock).not.toHaveBeenCalled();
    });

    it("persists the CORRECT-branch response (reinforcement) too", async () => {
      store.row = makeAttempt({ selfScore: "CORRECT" });

      const first = await generateFeedback("user-1", "attempt-1");

      expect(first.status).toBe("OK");
      expect(first.reinforcement).toBe("well done");
      expect(store.row?.feedbackStatus).toBe("READY");
      expect(store.row?.feedbackJson).toEqual(first);

      runTaskMock.mockClear();
      const second = await generateFeedback("user-1", "attempt-1");
      expect(second).toEqual(first);
      expect(runTaskMock).not.toHaveBeenCalled();
    });

    it("persists the empty-results response when search finds nothing", async () => {
      searchChunksMock.mockResolvedValue([]);

      const result = await generateFeedback("user-1", "attempt-1");

      expect(result).toEqual({ status: "OK", excerpts: [] });
      expect(store.row?.feedbackStatus).toBe("READY");
      expect(store.row?.feedbackJson).toEqual(result);
    });

    it("does not persist or claim for unscored (EXAM-phase) attempts", async () => {
      store.row = makeAttempt({ selfScore: null });

      const result = await generateFeedback("user-1", "attempt-1");

      expect(result).toEqual({ status: "OK", excerpts: [] });
      expect(store.row?.feedbackStatus).toBe("NONE");
      expect(store.row?.feedbackJson).toBeNull();
    });
  });

  describe("eager claim exclusivity", () => {
    it("returns null for the second concurrent claim — only one caller generates", async () => {
      const [a, b] = await Promise.all([
        generateFeedbackEager("user-1", "attempt-1"),
        generateFeedbackEager("user-1", "attempt-1"),
      ]);

      const winners = [a, b].filter((r) => r !== null);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe("OK");

      // Exactly one generation ran the AI feedback task
      const feedbackCalls = runTaskMock.mock.calls.filter(
        ([, spec]) => (spec as { task: string }).task === "GENERATE_FEEDBACK",
      );
      expect(feedbackCalls).toHaveLength(1);
      expect(store.row?.feedbackStatus).toBe("READY");
    });

    it("returns null when feedback is already READY", async () => {
      const first = await generateFeedbackEager("user-1", "attempt-1");
      expect(first?.status).toBe("OK");

      const second = await generateFeedbackEager("user-1", "attempt-1");
      expect(second).toBeNull();
    });

    it("returns null while another worker holds a live GENERATING claim", async () => {
      store.row = makeAttempt({
        feedbackStatus: "GENERATING",
        feedbackJson: { feedbackClaimedAt: new Date().toISOString() },
      });

      const result = await generateFeedbackEager("user-1", "attempt-1");

      expect(result).toBeNull();
      expect(runTaskMock).not.toHaveBeenCalled();
    });

    it("a GET during eager generation gets PENDING, not a duplicate generation", async () => {
      // Gate every in-flight searchChunks call so the eager generation
      // blocks while holding the GENERATING claim.
      const blocked: ((value: (typeof SEARCH_RESULT)[]) => void)[] = [];
      searchChunksMock.mockImplementation(
        () => new Promise((resolve) => { blocked.push(resolve); }),
      );

      const eager = generateFeedbackEager("user-1", "attempt-1");
      // Let the eager call take the claim and block on search
      await vi.waitFor(() => {
        expect(store.row?.feedbackStatus).toBe("GENERATING");
        expect(blocked.length).toBeGreaterThan(0);
      });

      const polled = await generateFeedback("user-1", "attempt-1");
      expect(polled).toEqual({ status: "PENDING", excerpts: [] });

      // Unblock: restore normal behavior for later calls (e.g. the Socratic
      // helper's search) and release everything currently in flight.
      searchChunksMock.mockImplementation(async () => [SEARCH_RESULT]);
      blocked.forEach((release) => release([SEARCH_RESULT]));

      const eagerResult = await eager;
      expect(eagerResult?.status).toBe("OK");
      expect(store.row?.feedbackStatus).toBe("READY");
    });
  });

  describe("PENDING and stale-claim handling", () => {
    it("returns PENDING while a live GENERATING claim is held", async () => {
      store.row = makeAttempt({
        feedbackStatus: "GENERATING",
        feedbackJson: { feedbackClaimedAt: new Date().toISOString() },
      });

      const result = await generateFeedback("user-1", "attempt-1");

      expect(result).toEqual({ status: "PENDING", excerpts: [] });
      expect(searchChunksMock).not.toHaveBeenCalled();
      expect(runTaskMock).not.toHaveBeenCalled();
    });

    it("reclaims a GENERATING claim older than 2 minutes and generates", async () => {
      const staleStamp = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      store.row = makeAttempt({
        feedbackStatus: "GENERATING",
        feedbackJson: { feedbackClaimedAt: staleStamp },
      });

      const result = await generateFeedback("user-1", "attempt-1");

      expect(result.status).toBe("OK");
      expect(result.explanation).toBe("ai-explanation");
      expect(store.row?.feedbackStatus).toBe("READY");
      expect(store.row?.feedbackJson).toEqual(result);
    });

    it("does not let two readers both reclaim the same stale claim (CAS on the stamp)", async () => {
      const staleStamp = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      store.row = makeAttempt({
        feedbackStatus: "GENERATING",
        feedbackJson: { feedbackClaimedAt: staleStamp },
      });

      const [a, b] = await Promise.all([
        generateFeedback("user-1", "attempt-1"),
        generateFeedback("user-1", "attempt-1"),
      ]);

      const statuses = [a.status, b.status].sort();
      expect(statuses).toEqual(["OK", "PENDING"]);
      const feedbackCalls = runTaskMock.mock.calls.filter(
        ([, spec]) => (spec as { task: string }).task === "GENERATE_FEEDBACK",
      );
      expect(feedbackCalls).toHaveLength(1);
    });
  });

  describe("failure handling", () => {
    it("resets feedbackStatus to NONE on generation failure so a retry can succeed", async () => {
      searchChunksMock.mockRejectedValue(new Error("fts exploded"));

      const failed = await generateFeedback("user-1", "attempt-1");

      expect(failed).toEqual({ status: "UNAVAILABLE", excerpts: [] });
      expect(store.row?.feedbackStatus).toBe("NONE");

      // Retry succeeds once the transient failure clears
      searchChunksMock.mockResolvedValue([SEARCH_RESULT]);
      const retried = await generateFeedback("user-1", "attempt-1");
      expect(retried.status).toBe("OK");
      expect(store.row?.feedbackStatus).toBe("READY");
    });

    it("returns NOT_FOUND (and releases nothing) for another user's attempt", async () => {
      const result = await generateFeedback("intruder", "attempt-1");
      expect(result).toEqual({ status: "NOT_FOUND", excerpts: [] });
      expect(store.row?.feedbackStatus).toBe("NONE");
    });

    it("eager call releases its claim and returns NOT_FOUND for another user's attempt", async () => {
      const result = await generateFeedbackEager("intruder", "attempt-1");
      expect(result).toEqual({ status: "NOT_FOUND", excerpts: [] });
      // Claim released so the rightful owner can still generate
      expect(store.row?.feedbackStatus).toBe("NONE");
    });
  });

  describe("hypercorrection input", () => {
    it("passes the attempt's confidenceRating into the GENERATE_FEEDBACK input", async () => {
      store.row = makeAttempt({ confidenceRating: 5 });

      await generateFeedback("user-1", "attempt-1");

      const feedbackCall = runTaskMock.mock.calls.find(
        ([, spec]) => (spec as { task: string }).task === "GENERATE_FEEDBACK",
      );
      expect(feedbackCall).toBeDefined();
      const input = (feedbackCall![1] as { input: { confidence?: number } }).input;
      expect(input.confidence).toBe(5);
    });
  });
});
