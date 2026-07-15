/**
 * Unit tests for the worked-example deck generator.
 *
 * Mocks the AI gateway runTask, the content-context service, and the prompt
 * registry (the GENERATE_WORKED_EXAMPLES template may land in a parallel
 * change) so tests exercise only deck construction and validation logic.
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

import { generateWorkedExampleDeck } from "@/lib/worked-examples";
import { getContentContextForSession } from "@/services/content-plan";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";

const contentMock = getContentContextForSession as ReturnType<typeof vi.fn>;
const runTaskMock = runTask as ReturnType<typeof vi.fn>;

const gatewayCtx = { userId: "user-1", provider: {} } as unknown as GatewayContext;

const DEFAULT_PARAMS = {
  userId: "user-1",
  courseName: "Physics",
  examName: "Midterm 1",
  topicScope: "Kinematics",
  objectives: [
    { id: "obj_0", title: "Projectile motion" },
    { id: "obj_1", title: "Free fall" },
  ],
  promptCount: 8,
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

function makeSet(objectiveId: string, label: string) {
  return {
    objective_id: objectiveId,
    problem: `${label} problem`,
    steps: [
      { action: `${label} action 1`, why: `${label} why 1` },
      { action: `${label} action 2`, why: `${label} why 2` },
      { action: `${label} action 3`, why: `${label} why 3` },
    ],
    completion_problem_1: `${label} completion 1`,
    completion_problem_2: `${label} completion 2`,
    full_problem: `${label} full problem`,
    model_answer: `${label} model answer`,
  };
}

function mockRunTaskSets(sets: unknown[]) {
  runTaskMock.mockImplementation(
    async (_ctx: unknown, spec: { parseOutput: (raw: unknown) => unknown }) => ({
      output: spec.parseOutput({ sets }),
      meta: {
        cacheHit: false,
        latencyMs: 5,
        promptVersion: "v1_test",
        model: "gpt-4o-mini",
        task: AiTask.GENERATE_WORKED_EXAMPLES,
      },
    }),
  );
}

describe("generateWorkedExampleDeck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    contentMock.mockResolvedValue({ snippets: makeSnippets(5), totalChunks: 20 });
  });

  it("returns null when gatewayCtx is null", async () => {
    const result = await generateWorkedExampleDeck({ ...DEFAULT_PARAMS, gatewayCtx: null });

    expect(result).toBeNull();
    expect(contentMock).not.toHaveBeenCalled();
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it("returns null when there is not enough content", async () => {
    contentMock.mockResolvedValue({ snippets: makeSnippets(1), totalChunks: 1 });

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).toBeNull();
    expect(runTaskMock).not.toHaveBeenCalled();
  });

  it("expands a valid 2-set response into 8 prompts in fade order", async () => {
    mockRunTaskSets([makeSet("obj_0", "A"), makeSet("obj_1", "B")]);

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(8);

    const deck = result!;

    // Sequential ids across the whole deck
    expect(deck.map((p) => p.id)).toEqual([
      "p_0", "p_1", "p_2", "p_3", "p_4", "p_5", "p_6", "p_7",
    ]);

    // Pack order repeats per set
    expect(deck.map((p) => p.meta?.pack)).toEqual([
      "WORKED_EXAMPLE", "WE_COMPLETION_1", "WE_COMPLETION_2", "WE_FULL",
      "WORKED_EXAMPLE", "WE_COMPLETION_1", "WE_COMPLETION_2", "WE_FULL",
    ]);

    // Difficulty fades 2 → 3 → 3 → 4
    expect(deck.map((p) => p.difficulty)).toEqual([2, 3, 3, 4, 2, 3, 3, 4]);

    // All FREE_RECALL, objective ids carried from each set
    expect(deck.every((p) => p.format === "FREE_RECALL")).toBe(true);
    expect(deck.slice(0, 4).every((p) => p.objective_id === "obj_0")).toBe(true);
    expect(deck.slice(4).every((p) => p.objective_id === "obj_1")).toBe(true);

    // STUDY prompt: problem, numbered steps with rationale, self-explanation
    const study = deck[0];
    expect(study.text).toContain("A problem");
    expect(study.text).toContain("Step 1: A action 1 — why: A why 1");
    expect(study.text).toContain("Step 3: A action 3 — why: A why 3");
    expect(study.text).toContain(
      "In your own words: why does step 3 follow from the previous steps?",
    );

    // COMPLETION 1: last step missing
    expect(deck[1].text).toContain("A completion 1");
    expect(deck[1].text).toContain(
      "(The final step is missing — supply it and state why it follows.)",
    );

    // COMPLETION 2: last two steps missing
    expect(deck[2].text).toContain("A completion 2");
    expect(deck[2].text).toContain("(The final two steps are missing — supply them.)");

    // FULL: bare problem, model answer stashed in meta for post-answer reveal
    expect(deck[3].text).toBe("A full problem");
    expect(deck[3].meta?.model_answer).toBe("A model answer");
    expect(deck[7].meta?.model_answer).toBe("B model answer");
  });

  it("requests clamp(ceil(promptCount / 4), 1, 3) sets from the model", async () => {
    mockRunTaskSets([makeSet("obj_0", "A")]);

    await generateWorkedExampleDeck({ ...DEFAULT_PARAMS, promptCount: 1 });
    await generateWorkedExampleDeck({ ...DEFAULT_PARAMS, promptCount: 8 });
    await generateWorkedExampleDeck({ ...DEFAULT_PARAMS, promptCount: 40 });

    const setCounts = runTaskMock.mock.calls.map(
      (c) => (c[1] as { input: { setCount: number } }).input.setCount,
    );
    expect(setCounts).toEqual([1, 2, 3]);
  });

  it("passes course context and content chunks to the task input", async () => {
    mockRunTaskSets([makeSet("obj_0", "A")]);

    await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(contentMock).toHaveBeenCalledWith(
      "user-1",
      "Physics",
      "WORKED_EXAMPLES",
      ["Projectile motion", "Free fall"],
      15,
    );

    const spec = runTaskMock.mock.calls[0][1] as {
      task: AiTask;
      promptVersion: string;
      input: Record<string, unknown>;
    };
    expect(spec.task).toBe(AiTask.GENERATE_WORKED_EXAMPLES);
    expect(spec.promptVersion).toBe("v1_test");
    expect(spec.input.courseName).toBe("Physics");
    expect(spec.input.examName).toBe("Midterm 1");
    expect(spec.input.topicScope).toBe("Kinematics");
    expect(spec.input.objectives).toEqual(DEFAULT_PARAMS.objectives);
    expect(spec.input.contentChunks).toEqual(
      makeSnippets(5).map(({ doc_title, page_number, text }) => ({
        doc_title,
        page_number,
        text,
      })),
    );
  });

  it("skips invalid sets (missing fields or <2 steps) but keeps valid ones", async () => {
    const missingProblem = { ...makeSet("obj_0", "X"), problem: "" };
    const missingFullProblem = { ...makeSet("obj_0", "Y"), full_problem: undefined };
    const tooFewSteps = {
      ...makeSet("obj_0", "Z"),
      steps: [{ action: "only", why: "one" }],
    };
    const missingSteps = { ...makeSet("obj_0", "W"), steps: undefined };
    const valid = makeSet("obj_1", "B");

    mockRunTaskSets([missingProblem, missingFullProblem, tooFewSteps, missingSteps, valid]);

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
    expect(result!.every((p) => p.objective_id === "obj_1")).toBe(true);
    expect(result![0].meta?.pack).toBe("WORKED_EXAMPLE");
    expect(result![3].meta?.pack).toBe("WE_FULL");
  });

  it("returns null when all sets are invalid", async () => {
    mockRunTaskSets([
      { ...makeSet("obj_0", "X"), problem: "" },
      { ...makeSet("obj_0", "Y"), steps: [] },
    ]);

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).toBeNull();
  });

  it("returns null when the model returns no sets", async () => {
    mockRunTaskSets([]);

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).toBeNull();
  });

  it("caps the deck at setCount * 4 prompts when the model over-delivers", async () => {
    // promptCount 4 → setCount 1, but the model returns 3 sets
    mockRunTaskSets([makeSet("obj_0", "A"), makeSet("obj_1", "B"), makeSet("obj_1", "C")]);

    const result = await generateWorkedExampleDeck({ ...DEFAULT_PARAMS, promptCount: 4 });

    expect(result).not.toBeNull();
    expect(result).toHaveLength(4);
    expect(result!.every((p) => p.objective_id === "obj_0")).toBe(true);
  });

  it("returns null when runTask throws", async () => {
    runTaskMock.mockRejectedValue(new Error("provider down"));

    const result = await generateWorkedExampleDeck(DEFAULT_PARAMS);

    expect(result).toBeNull();
  });
});
