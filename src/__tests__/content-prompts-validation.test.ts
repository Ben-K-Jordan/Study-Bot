/**
 * Unit tests for model-output validation in generateContentAwarePrompts.
 *
 * The model's JSON is untrusted: prompts without real question text or an
 * objective id must be dropped (never persisted into a run), and when fewer
 * than 3 valid prompts survive the generator must return null so callers
 * fall back to deterministic prompts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/services/content-plan", () => ({
  getContentContextForSession: vi.fn(),
}));

vi.mock("@/lib/ai/gateway", () => ({
  runTask: vi.fn(),
}));

vi.mock("@/lib/ai/prompt-registry", () => ({
  getPrompt: vi.fn(() => ({ version: "v1_test" })),
}));

vi.mock("@/lib/mastery", () => ({
  getMasterySummary: vi.fn(async () => ({ total: 0, mastered: 0, due: 0, objectives: [] })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    sessionErrorLog: { findMany: vi.fn(async () => []) },
  },
}));

import { generateContentAwarePrompts } from "@/lib/content-prompts";
import { getContentContextForSession } from "@/services/content-plan";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";

const contentMock = getContentContextForSession as ReturnType<typeof vi.fn>;
const runTaskMock = runTask as ReturnType<typeof vi.fn>;

const gatewayCtx = { userId: "user-1", provider: {} } as unknown as GatewayContext;

const DEFAULT_PARAMS = {
  userId: "user-1",
  courseName: "Biology",
  examName: "Midterm 1",
  mode: "RETRIEVAL",
  topicScope: "Cell transport",
  objectives: [
    { id: "obj_0", title: "Osmosis" },
    { id: "obj_1", title: "Active transport" },
  ],
  promptCount: 6,
  gatewayCtx,
};

function makeSnippets(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    chunk_id: `c_${i}`,
    doc_title: `Lecture ${i}`,
    page_number: i + 1,
    text: `content ${i}`,
  }));
}

function validPrompt(i: number, objectiveId = "obj_0") {
  return {
    objective_id: objectiveId,
    text: `Question ${i}: explain the mechanism.`,
    difficulty: 2,
    format: "FREE_RECALL",
  };
}

function mockRunTaskRaw(raw: unknown) {
  runTaskMock.mockImplementation(
    async (_ctx: unknown, spec: { parseOutput: (r: unknown) => unknown }) => ({
      output: spec.parseOutput(raw),
      meta: { cacheHit: false, latencyMs: 1, promptVersion: "v1_test", model: "m", task: "GENERATE_PROMPTS" },
    }),
  );
}

describe("generateContentAwarePrompts output validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentMock.mockResolvedValue({ snippets: makeSnippets(5), totalChunks: 20 });
  });

  it("drops prompts with missing/empty/non-string text or missing objective_id", async () => {
    mockRunTaskRaw({
      prompts: [
        validPrompt(1),
        { objective_id: "obj_0", text: 42, difficulty: 1 }, // non-string text
        { objective_id: "obj_0", text: "   ", difficulty: 1 }, // blank text
        { objective_id: "obj_0", difficulty: 1 }, // missing text
        { text: "No objective id", difficulty: 1 }, // missing objective_id
        { objective_id: 7, text: "Numeric objective id", difficulty: 1 }, // non-string objective_id
        null, // not even an object
        validPrompt(2, "obj_1"),
        validPrompt(3, "obj_1"),
      ],
    });

    const result = await generateContentAwarePrompts(DEFAULT_PARAMS);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result!.map((p) => p.text)).toEqual([
      "Question 1: explain the mechanism.",
      "Question 2: explain the mechanism.",
      "Question 3: explain the mechanism.",
    ]);
    // Sequential ids assigned after filtering
    expect(result!.map((p) => p.id)).toEqual(["p_0", "p_1", "p_2"]);
  });

  it("returns null when fewer than 3 valid prompts survive", async () => {
    mockRunTaskRaw({
      prompts: [
        validPrompt(1),
        validPrompt(2),
        { objective_id: "obj_0", text: "", difficulty: 1 },
        { text: "orphan", difficulty: 1 },
      ],
    });

    const result = await generateContentAwarePrompts(DEFAULT_PARAMS);

    expect(result).toBeNull();
  });

  it("returns null when the model returns no prompts", async () => {
    mockRunTaskRaw({ prompts: [] });

    expect(await generateContentAwarePrompts(DEFAULT_PARAMS)).toBeNull();
  });

  it("returns null when prompts is not an array", async () => {
    mockRunTaskRaw({ prompts: "not-an-array" });

    expect(await generateContentAwarePrompts(DEFAULT_PARAMS)).toBeNull();
  });

  it("returns null when the raw output is not an object", async () => {
    mockRunTaskRaw(null);

    expect(await generateContentAwarePrompts(DEFAULT_PARAMS)).toBeNull();
  });

  it("demotes an MCQ with an out-of-range correct_index to FREE_RECALL without throwing", async () => {
    mockRunTaskRaw({
      prompts: [
        validPrompt(1),
        validPrompt(2),
        {
          objective_id: "obj_1",
          text: "Off-by-one MCQ",
          difficulty: 2,
          format: "MCQ",
          choices: ["A", "B", "C", "D"],
          correct_index: 4, // 1-based off-by-one — unanswerable as MCQ
        },
      ],
    });

    const result = await generateContentAwarePrompts(DEFAULT_PARAMS);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    const demoted = result!.find((p) => p.text === "Off-by-one MCQ")!;
    expect(demoted.format).toBe("FREE_RECALL");
    expect(demoted.choices).toBeUndefined();
    expect(demoted.correctIndex).toBeUndefined();
  });

  it("keeps a well-formed MCQ intact (choices, valid index, answer meta)", async () => {
    mockRunTaskRaw({
      prompts: [
        validPrompt(1),
        validPrompt(2),
        {
          objective_id: "obj_1",
          text: "Valid MCQ",
          difficulty: 2,
          format: "MCQ",
          choices: ["A", "B", "C", "D"],
          correct_index: 1,
          model_answer: "B is correct.",
          key_points: ["point one", "point two"],
        },
      ],
    });

    const result = await generateContentAwarePrompts(DEFAULT_PARAMS);

    expect(result).not.toBeNull();
    const mcq = result!.find((p) => p.text === "Valid MCQ")!;
    expect(mcq.format).toBe("MCQ");
    expect(mcq.choices).toHaveLength(4);
    expect(mcq.correctIndex).toBeGreaterThanOrEqual(0);
    expect(mcq.correctIndex).toBeLessThan(4);
    // The shuffled correct choice still points at the right answer
    expect(mcq.choices![mcq.correctIndex!]).toBe("B");
    expect(mcq.meta?.model_answer).toBe("B is correct.");
    expect(mcq.meta?.key_points).toEqual(["point one", "point two"]);
  });

  it("returns null when runTask throws", async () => {
    runTaskMock.mockRejectedValue(new Error("provider down"));

    expect(await generateContentAwarePrompts(DEFAULT_PARAMS)).toBeNull();
  });
});
