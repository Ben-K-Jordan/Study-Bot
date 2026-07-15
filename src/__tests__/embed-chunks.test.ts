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

// Mock the AI gateway so no provider/budget/circuit logic runs
vi.mock("@/lib/ai/gateway", () => ({
  embed: vi.fn(),
}));

import { handleEmbedChunkBatch } from "@/lib/jobs/handlers/embed-chunks";
import { embed } from "@/lib/ai/gateway";
import { prisma } from "@/lib/db";
import { MockProvider } from "@/lib/ai/providers/mock";

const chunkStore = (prisma as unknown as { _test: { chunks: ChunkRow[] } })._test.chunks;
const embedMock = vi.mocked(embed);
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
});
