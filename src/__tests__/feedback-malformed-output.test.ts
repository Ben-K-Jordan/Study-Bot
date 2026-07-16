/**
 * Unit tests for model-output hardening in the feedback service.
 *
 * The AI's JSON is untrusted: fields that are not strings (numbers, arrays,
 * objects, booleans) must be dropped from the FeedbackResponse — never
 * persisted into feedbackJson — and generation must not throw.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AiTask } from "@/lib/ai/types";

const updateManyCalls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];

vi.mock("@/lib/db", () => {
  const prisma = {
    sessionAttempt: {
      findUnique: vi.fn(),
      updateMany: vi.fn(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        updateManyCalls.push(args);
        return { count: 1 };
      }),
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

vi.mock("@/lib/search", () => ({
  searchChunks: vi.fn(async () => [
    {
      chunk_id: "chunk-1",
      doc_id: "doc-1",
      doc_title: "Notes",
      page_number: 2,
      rank_score: 1,
      snippet: "relevant snippet",
    },
  ]),
  buildFeedbackQuery: vi.fn(() => "query"),
}));

// Avoid constructing a real OpenAI provider when AI_PROVIDER=openai
vi.mock("@/lib/ai/provider-factory", () => ({
  createProvider: vi.fn(() => ({})),
}));

vi.mock("@/lib/ai/gateway", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gateway")>();
  return { ...actual, runTask: vi.fn() };
});

import { generateFeedback } from "@/services/feedback";
import { prisma } from "@/lib/db";
import { runTask } from "@/lib/ai/gateway";

const findUniqueAttemptMock = prisma.sessionAttempt.findUnique as ReturnType<typeof vi.fn>;
const runTaskMock = runTask as ReturnType<typeof vi.fn>;

function makeAttempt(selfScore: "CORRECT" | "INCORRECT") {
  return {
    id: "attempt-1",
    runId: "run-1",
    promptIndex: 0,
    promptText: "What is osmosis?",
    userAnswer: "an answer",
    selfScore,
    confidenceRating: null,
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
    citations: [],
  };
}

/** Route runTask through the real parseOutput with per-task raw JSON. */
function mockRawByTask(rawByTask: Partial<Record<string, unknown>>) {
  runTaskMock.mockImplementation(
    async (_ctx: unknown, spec: { task: string; parseOutput: (r: unknown) => unknown }) => ({
      output: spec.parseOutput(rawByTask[spec.task]),
      meta: { cacheHit: false, latencyMs: 1, promptVersion: "v", model: "m", task: spec.task },
    }),
  );
}

const MALFORMED_FEEDBACK_RAW = {
  explanation: 42,
  key_takeaway: ["not", "a", "string"],
  concept_connection: { nested: true },
  mnemonic: 3.14,
  pattern_advice: false,
  referenced_chunk_ids: "not-an-array",
};

const MALFORMED_SOCRATIC_RAW = {
  followup_question: ["why?"],
  purpose: 7,
};

const MALFORMED_REINFORCEMENT_RAW = {
  reinforcement: { text: "nested" },
  deeper_insight: 0,
  concept_connection: [],
};

describe("feedback model-output hardening", () => {
  const prevProvider = process.env.AI_PROVIDER;

  beforeEach(() => {
    vi.clearAllMocks();
    updateManyCalls.length = 0;
    process.env.AI_PROVIDER = "openai";
  });

  afterEach(() => {
    if (prevProvider === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = prevProvider;
  });

  it("drops all malformed explanation/socratic fields for INCORRECT without throwing", async () => {
    findUniqueAttemptMock.mockResolvedValue(makeAttempt("INCORRECT"));
    mockRawByTask({
      [AiTask.GENERATE_FEEDBACK]: MALFORMED_FEEDBACK_RAW,
      [AiTask.SOCRATIC_FOLLOWUP]: MALFORMED_SOCRATIC_RAW,
    });

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.excerpts).toHaveLength(1);
    expect(result.explanation).toBeUndefined();
    expect(result.key_takeaway).toBeUndefined();
    expect(result.concept_connection).toBeUndefined();
    expect(result.mnemonic).toBeUndefined();
    expect(result.pattern_advice).toBeUndefined();
    expect(result.socratic_followup).toBeUndefined();
    expect(result.socratic_purpose).toBeUndefined();
  });

  it("never persists malformed fields into feedbackJson", async () => {
    findUniqueAttemptMock.mockResolvedValue(makeAttempt("INCORRECT"));
    mockRawByTask({
      [AiTask.GENERATE_FEEDBACK]: MALFORMED_FEEDBACK_RAW,
      [AiTask.SOCRATIC_FOLLOWUP]: MALFORMED_SOCRATIC_RAW,
    });

    await generateFeedback("user-1", "attempt-1");

    const persisted = updateManyCalls.find((c) => c.data.feedbackStatus === "READY");
    expect(persisted).toBeDefined();
    // Prisma persists JSON via serialization, which strips undefined-valued
    // keys — assert on the serialized form, i.e. what actually reaches the DB.
    const json = JSON.parse(
      JSON.stringify(persisted!.data.feedbackJson),
    ) as Record<string, unknown>;
    expect(json.status).toBe("OK");
    // Only status + excerpts survive — no key carries a non-string AI field
    for (const [key, value] of Object.entries(json)) {
      if (key === "excerpts") continue;
      expect(typeof value, `field ${key} must be a string`).toBe("string");
    }
    expect(json).not.toHaveProperty("explanation");
    expect(json).not.toHaveProperty("key_takeaway");
    expect(json).not.toHaveProperty("mnemonic");
    expect(json).not.toHaveProperty("socratic_followup");
  });

  it("drops malformed reinforcement fields for CORRECT without throwing", async () => {
    findUniqueAttemptMock.mockResolvedValue(makeAttempt("CORRECT"));
    mockRawByTask({
      [AiTask.REINFORCE_CORRECT]: MALFORMED_REINFORCEMENT_RAW,
      [AiTask.SOCRATIC_FOLLOWUP]: MALFORMED_SOCRATIC_RAW,
    });

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.reinforcement).toBeUndefined();
    expect(result.deeper_insight).toBeUndefined();
    expect(result.concept_connection).toBeUndefined();
    expect(result.socratic_followup).toBeUndefined();
  });

  it("keeps well-formed string fields (sanity)", async () => {
    findUniqueAttemptMock.mockResolvedValue(makeAttempt("INCORRECT"));
    mockRawByTask({
      [AiTask.GENERATE_FEEDBACK]: {
        explanation: "You skipped the gradient direction.",
        key_takeaway: "Water moves toward higher solute concentration.",
        concept_connection: "Related to diffusion.",
        mnemonic: null,
        pattern_advice: null,
        referenced_chunk_ids: ["chunk-1"],
      },
      [AiTask.SOCRATIC_FOLLOWUP]: {
        followup_question: "What happens if the membrane is impermeable?",
        purpose: "Probe boundary conditions.",
      },
    });

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.explanation).toBe("You skipped the gradient direction.");
    expect(result.key_takeaway).toBe("Water moves toward higher solute concentration.");
    expect(result.concept_connection).toBe("Related to diffusion.");
    expect(result.mnemonic).toBeUndefined();
    expect(result.socratic_followup).toBe("What happens if the membrane is impermeable?");
    expect(result.socratic_purpose).toBe("Probe boundary conditions.");
  });

  it("tolerates a completely non-object model payload", async () => {
    findUniqueAttemptMock.mockResolvedValue(makeAttempt("INCORRECT"));
    mockRawByTask({
      [AiTask.GENERATE_FEEDBACK]: "plain text, not json",
      [AiTask.SOCRATIC_FOLLOWUP]: 12345,
    });

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.explanation).toBeUndefined();
    expect(result.socratic_followup).toBeUndefined();
  });
});
