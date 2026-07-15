/**
 * Unit tests for the objective-anchor fast path in generateFeedback.
 *
 * The anchor build side stores examName as "" when exam_name is omitted,
 * while sessions always carry a non-empty examName — the lookup must match
 * both keys, preferring exact matches.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface AnchorRow {
  id: string;
  userId: string;
  courseName: string;
  examName: string;
  objectiveId: string;
  chunkId: string;
  rank: number;
  chunk: {
    pageNumber: number | null;
    text: string;
    document: { id: string; title: string };
  };
}

const anchorRows: AnchorRow[] = [];

// Mock prisma before importing the service
vi.mock("@/lib/db", () => {
  const prisma = {
    sessionAttempt: {
      findUnique: vi.fn(),
      // Claim (NONE -> GENERATING) always succeeds in these tests
      updateMany: vi.fn(async () => ({ count: 1 })),
      // Persist (READY + feedbackJson)
      update: vi.fn(async () => ({})),
    },
    sessionErrorLog: {
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
    },
    sessionRunPrompt: { findUnique: vi.fn() },
    objectiveAnchor: {
      findMany: vi.fn(
        async ({ where }: { where: { objectiveId: string; examName: string | { in: string[] } } }) => {
          // Simulate DB filtering for both string and { in: [...] } shapes
          const examNames =
            typeof where.examName === "string" ? [where.examName] : where.examName.in;
          return anchorRows
            .filter(
              (a) => a.objectiveId === where.objectiveId && examNames.includes(a.examName),
            )
            .sort((a, b) => a.rank - b.rank);
        },
      ),
    },
    attemptCitation: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  };
  return { prisma };
});

vi.mock("@/lib/search", () => ({
  searchChunks: vi.fn(async () => []),
  buildFeedbackQuery: vi.fn(() => "query"),
}));

import { generateFeedback } from "@/services/feedback";
import { prisma } from "@/lib/db";
import { searchChunks } from "@/lib/search";

const findUniqueAttemptMock = prisma.sessionAttempt.findUnique as ReturnType<typeof vi.fn>;
const findUniquePromptMock = prisma.sessionRunPrompt.findUnique as ReturnType<typeof vi.fn>;
const findManyAnchorsMock = prisma.objectiveAnchor.findMany as ReturnType<typeof vi.fn>;
const searchChunksMock = searchChunks as ReturnType<typeof vi.fn>;

function makeAnchor(overrides: Partial<AnchorRow> & { chunkId: string }): AnchorRow {
  return {
    id: `anchor-${overrides.chunkId}`,
    userId: "user-1",
    courseName: "Biology",
    examName: "",
    objectiveId: "obj-1",
    rank: 1,
    chunk: {
      pageNumber: 3,
      text: `Chunk text for ${overrides.chunkId}`,
      document: { id: "doc-1", title: "Cell Biology Notes" },
    },
    ...overrides,
  };
}

const ATTEMPT = {
  id: "attempt-1",
  runId: "run-1",
  promptIndex: 0,
  promptText: "What is osmosis?",
  userAnswer: "something wrong",
  selfScore: "INCORRECT",
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

describe("generateFeedback objective anchors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    anchorRows.length = 0;
    findUniqueAttemptMock.mockResolvedValue(ATTEMPT);
    findUniquePromptMock.mockResolvedValue({ objectiveId: "obj-1" });
  });

  it("serves anchors stored with empty examName when the session has one", async () => {
    anchorRows.push(
      makeAnchor({ chunkId: "chunk-a", rank: 1 }),
      makeAnchor({ chunkId: "chunk-b", rank: 2 }),
    );

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.excerpts.map((e) => e.chunk_id)).toEqual(["chunk-a", "chunk-b"]);
    expect(result.excerpts[0].doc_title).toBe("Cell Biology Notes");

    // The lookup queried both the session examName and the legacy "" key
    expect(findManyAnchorsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ examName: { in: ["Midterm 1", ""] } }),
      }),
    );

    // Fast path hit — no FTS fallback
    expect(searchChunksMock).not.toHaveBeenCalled();
  });

  it("prefers exact examName anchors over legacy empty-key rows", async () => {
    anchorRows.push(
      makeAnchor({ chunkId: "legacy-1", examName: "", rank: 1 }),
      makeAnchor({ chunkId: "legacy-2", examName: "", rank: 2 }),
      makeAnchor({ chunkId: "exact-1", examName: "Midterm 1", rank: 1 }),
      makeAnchor({ chunkId: "exact-2", examName: "Midterm 1", rank: 2 }),
    );

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.excerpts.map((e) => e.chunk_id)).toEqual(["exact-1", "exact-2"]);
  });

  it("caps anchor results at five excerpts", async () => {
    for (let i = 1; i <= 7; i++) {
      anchorRows.push(makeAnchor({ chunkId: `chunk-${i}`, rank: i }));
    }

    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.excerpts).toHaveLength(5);
    expect(result.excerpts.map((e) => e.chunk_id)).toEqual([
      "chunk-1",
      "chunk-2",
      "chunk-3",
      "chunk-4",
      "chunk-5",
    ]);
  });

  it("falls back to FTS when no anchors exist for the objective", async () => {
    const result = await generateFeedback("user-1", "attempt-1");

    expect(result.status).toBe("OK");
    expect(result.excerpts).toEqual([]);
    expect(findManyAnchorsMock).toHaveBeenCalled();
    expect(searchChunksMock).toHaveBeenCalled();
  });
});
