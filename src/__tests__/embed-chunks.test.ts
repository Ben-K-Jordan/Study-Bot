/**
 * Unit tests for the EMBED_CHUNK_BATCH job handler.
 *
 * Verifies that job retries are not no-ops: FAILED and IN_PROGRESS chunks
 * (from a previous failed attempt or a dead worker) are re-fetched and
 * embedded, while DONE chunks are never re-processed or clobbered.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

interface ChunkRow {
  id: string;
  text: string;
  embeddingStatus: string;
}

// Mock prisma with an in-memory chunk store that applies where-clause semantics
vi.mock("@/lib/db", () => {
  const chunks: ChunkRow[] = [];

  const matchesStatus = (status: string, cond: unknown): boolean => {
    if (cond === undefined) return true;
    if (typeof cond === "string") return status === cond;
    const c = cond as { in?: string[]; not?: string; notIn?: string[] };
    if (c.in) return c.in.includes(status);
    if (c.not !== undefined) return status !== c.not;
    if (c.notIn) return !c.notIn.includes(status);
    return true;
  };

  type ChunkWhere = { id: { in: string[] }; embeddingStatus?: unknown };
  const matching = (where: ChunkWhere) =>
    chunks.filter((c) => where.id.in.includes(c.id) && matchesStatus(c.embeddingStatus, where.embeddingStatus));

  return {
    prisma: {
      contentChunk: {
        findMany: vi.fn(async ({ where }: { where: ChunkWhere }) =>
          matching(where).map((c) => ({ id: c.id, text: c.text })),
        ),
        updateMany: vi.fn(
          async ({ where, data }: { where: ChunkWhere; data: { embeddingStatus: string } }) => {
            const rows = matching(where);
            for (const row of rows) row.embeddingStatus = data.embeddingStatus;
            return { count: rows.length };
          },
        ),
      },
      // Emulates the raw UPDATE that stores an embedding and marks the chunk DONE
      $executeRawUnsafe: vi.fn(async (_sql: string, ...params: unknown[]) => {
        const chunk = chunks.find((c) => c.id === (params[3] as string));
        if (!chunk) return 0;
        chunk.embeddingStatus = "DONE";
        return 1;
      }),
      _test: { chunks },
    },
  };
});

// Mock the AI gateway's embed so no provider/budget/circuit logic runs
// (GatewayError stays real so the handler can recognize budget errors)
vi.mock("@/lib/ai/gateway", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gateway")>()),
  embed: vi.fn(),
}));

vi.mock("@/lib/jobs/queue", () => ({
  enqueueJob: vi.fn(async () => "job_deferred"),
}));

import {
  handleEmbedChunkBatch,
  sliceForEmbedding,
  estimateTokens,
  MAX_INPUTS_PER_REQUEST,
} from "@/lib/jobs/handlers/embed-chunks";
import { embed, GatewayError } from "@/lib/ai/gateway";
import { enqueueJob } from "@/lib/jobs/queue";
import { prisma } from "@/lib/db";
import { MockProvider } from "@/lib/ai/providers/mock";

const chunkStore = (prisma as unknown as { _test: { chunks: ChunkRow[] } })._test.chunks;
const embedMock = vi.mocked(embed);
const enqueueMock = vi.mocked(enqueueJob);
const executeRawMock = prisma.$executeRawUnsafe as unknown as Mock;

function seedChunks(...rows: ChunkRow[]) {
  chunkStore.push(...rows);
}

function statusOf(id: string): string | undefined {
  return chunkStore.find((c) => c.id === id)?.embeddingStatus;
}

describe("handleEmbedChunkBatch", () => {
  const provider = new MockProvider();

  beforeEach(() => {
    vi.clearAllMocks();
    chunkStore.length = 0;
    embedMock.mockImplementation(async (_ctx, texts) => ({
      embeddings: texts.map((_, i) => [i, i + 1, i + 2]),
    }));
  });

  it("embeds PENDING and NONE chunks and marks them DONE", async () => {
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "PENDING" },
      { id: "c2", text: "beta", embeddingStatus: "NONE" },
    );

    await handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(embedMock.mock.calls[0][1]).toEqual(["alpha", "beta"]);
    expect(statusOf("c1")).toBe("DONE");
    expect(statusOf("c2")).toBe("DONE");
  });

  it("re-embeds FAILED chunks on retry instead of skipping them", async () => {
    // Simulates a retry after a previous attempt marked the batch FAILED
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "FAILED" },
      { id: "c2", text: "beta", embeddingStatus: "FAILED" },
    );

    await handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(statusOf("c1")).toBe("DONE");
    expect(statusOf("c2")).toBe("DONE");
  });

  it("recovers chunks left IN_PROGRESS by a dead worker", async () => {
    seedChunks({ id: "c1", text: "alpha", embeddingStatus: "IN_PROGRESS" });

    await handleEmbedChunkBatch({ chunkIds: ["c1"], userId: "u1" }, provider);

    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(statusOf("c1")).toBe("DONE");
  });

  it("skips chunks that are already DONE", async () => {
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "DONE" },
      { id: "c2", text: "beta", embeddingStatus: "DONE" },
    );

    await handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider);

    expect(embedMock).not.toHaveBeenCalled();
    expect(statusOf("c1")).toBe("DONE");
    expect(statusOf("c2")).toBe("DONE");
  });

  it("marks unfinished chunks FAILED and rethrows when embedding fails", async () => {
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "PENDING" },
      { id: "c2", text: "beta", embeddingStatus: "PENDING" },
    );
    embedMock.mockRejectedValueOnce(new Error("gateway down"));

    await expect(
      handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider),
    ).rejects.toThrow("gateway down");

    expect(statusOf("c1")).toBe("FAILED");
    expect(statusOf("c2")).toBe("FAILED");
  });

  it("does not clobber DONE chunks when a partial write fails, and the retry finishes the rest", async () => {
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "PENDING" },
      { id: "c2", text: "beta", embeddingStatus: "PENDING" },
    );
    // First chunk write succeeds, second throws mid-batch
    executeRawMock.mockImplementationOnce(async (_sql: string, ...params: unknown[]) => {
      const chunk = chunkStore.find((c) => c.id === (params[3] as string));
      if (chunk) chunk.embeddingStatus = "DONE";
      return 1;
    });
    executeRawMock.mockImplementationOnce(async () => {
      throw new Error("db write failed");
    });

    await expect(
      handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider),
    ).rejects.toThrow("db write failed");

    expect(statusOf("c1")).toBe("DONE");
    expect(statusOf("c2")).toBe("FAILED");

    // Retry (same payload) embeds only the failed chunk and completes the batch
    await handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider);

    expect(embedMock).toHaveBeenCalledTimes(2);
    expect(embedMock.mock.calls[1][1]).toEqual(["beta"]);
    expect(statusOf("c1")).toBe("DONE");
    expect(statusOf("c2")).toBe("DONE");
  });

  it("returns early when chunkIds is empty", async () => {
    await handleEmbedChunkBatch({ chunkIds: [], userId: "u1" }, provider);

    expect(embedMock).not.toHaveBeenCalled();
  });

  it("embeds a large document in request-sized slices, against the upload budget", async () => {
    const ids = Array.from({ length: 600 }, (_, i) => `c${i}`);
    seedChunks(...ids.map((id) => ({ id, text: `text ${id}`, embeddingStatus: "PENDING" })));

    await handleEmbedChunkBatch({ chunkIds: ids, userId: "u1" }, provider);

    expect(embedMock.mock.calls.map((c) => c[1].length)).toEqual([
      MAX_INPUTS_PER_REQUEST,
      MAX_INPUTS_PER_REQUEST,
      600 - 2 * MAX_INPUTS_PER_REQUEST,
    ]);
    for (const call of embedMock.mock.calls) expect(call[3]).toEqual({ budget: "upload" });
    expect(ids.every((id) => statusOf(id) === "DONE")).toBe(true);
  });

  it("defers the rest to the next budget day when the upload budget runs out", async () => {
    const ids = Array.from({ length: MAX_INPUTS_PER_REQUEST + 3 }, (_, i) => `c${i}`);
    seedChunks(...ids.map((id) => ({ id, text: `text ${id}`, embeddingStatus: "PENDING" })));
    embedMock
      .mockImplementationOnce(async (_ctx, texts) => ({ embeddings: texts.map(() => [1, 2, 3]) }))
      .mockRejectedValueOnce(new GatewayError("BUDGET_EXCEEDED", "Daily embedding budget reached.", false));

    const before = Date.now();
    await handleEmbedChunkBatch({ chunkIds: ids, userId: "u1" }, provider);

    const firstSlice = ids.slice(0, MAX_INPUTS_PER_REQUEST);
    const rest = ids.slice(MAX_INPUTS_PER_REQUEST);
    expect(firstSlice.every((id) => statusOf(id) === "DONE")).toBe(true);
    // Not FAILED: the deferred job picks them up after the budget resets
    expect(rest.map(statusOf)).toEqual(["PENDING", "PENDING", "PENDING"]);

    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const [type, payload, opts] = enqueueMock.mock.calls[0];
    expect(type).toBe("EMBED_CHUNK_BATCH");
    expect(payload).toEqual({ chunkIds: rest, userId: "u1" });
    const runAfter = (opts as { runAfter: Date }).runAfter;
    expect(runAfter.getTime()).toBeGreaterThan(before);
    expect(runAfter.getUTCHours()).toBe(0);
  });

  it("fails the batch when the provider returns the wrong number of vectors", async () => {
    seedChunks(
      { id: "c1", text: "alpha", embeddingStatus: "PENDING" },
      { id: "c2", text: "beta", embeddingStatus: "PENDING" },
    );
    embedMock.mockResolvedValueOnce({ embeddings: [[1, 2, 3]] });

    await expect(
      handleEmbedChunkBatch({ chunkIds: ["c1", "c2"], userId: "u1" }, provider),
    ).rejects.toThrow(/count mismatch/);

    expect(statusOf("c1")).toBe("FAILED");
    expect(statusOf("c2")).toBe("FAILED");
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe("sliceForEmbedding", () => {
  const items = (n: number, chars: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, text: "x".repeat(chars) }));

  it("caps inputs per request and keeps the order", () => {
    const slices = sliceForEmbedding(items(5, 10), 2, 1_000);
    expect(slices.map((s) => s.map((c) => c.id))).toEqual([["c0", "c1"], ["c2", "c3"], ["c4"]]);
  });

  it("caps estimated tokens per request", () => {
    const perItem = estimateTokens("x".repeat(1_600));
    const slices = sliceForEmbedding(items(10, 1_600), 100, perItem * 4);
    expect(slices.map((s) => s.length)).toEqual([4, 4, 2]);
  });

  it("gives an oversized item a request of its own", () => {
    const slices = sliceForEmbedding([{ text: "x".repeat(900) }, { text: "y" }], 10, 100);
    expect(slices.map((s) => s.length)).toEqual([1, 1]);
  });

  it("returns no slices for no items", () => {
    expect(sliceForEmbedding([])).toEqual([]);
  });
});
