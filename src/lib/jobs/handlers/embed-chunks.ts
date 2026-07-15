/**
 * EMBED_CHUNK_BATCH job handler.
 *
 * Fetches chunk texts from the DB, generates embeddings via the AI gateway,
 * and stores them as pgvector vectors using raw SQL.
 */
import { prisma } from "../../db";
import { embed, type GatewayContext } from "../../ai/gateway";
import { logger } from "../../logger";

const EMBED_MODEL = process.env.AI_MODEL_EMBED || "text-embedding-3-small";
const EMBED_DIM = 1536;

export interface EmbedChunkBatchPayload {
  chunkIds: string[];
  userId: string;
}

/**
 * Process a batch of chunks: generate embeddings and store them.
 */
export async function handleEmbedChunkBatch(
  payload: unknown,
  provider: import("../../ai/provider").AiProvider,
): Promise<void> {
  const { chunkIds, userId } = payload as EmbedChunkBatchPayload;

  if (!chunkIds?.length) return;

  // Fetch chunks that still need embedding. The payload's chunkIds already
  // scope the work, so pick up any non-DONE status: this lets job retries
  // re-process FAILED chunks and recovers chunks left IN_PROGRESS by a dead
  // worker instead of silently skipping them.
  const chunks = await prisma.contentChunk.findMany({
    where: {
      id: { in: chunkIds },
      embeddingStatus: { not: "DONE" },
    },
    select: { id: true, text: true },
  });

  if (chunks.length === 0) {
    logger.info("embed.skip", { reason: "all_chunks_embedded", chunkIds });
    return;
  }

  const fetchedIds = chunks.map((c) => c.id);

  // Mark as IN_PROGRESS
  await prisma.contentChunk.updateMany({
    where: { id: { in: fetchedIds } },
    data: { embeddingStatus: "IN_PROGRESS" },
  });

  const ctx: GatewayContext = { userId, provider };

  try {
    const result = await embed(ctx, chunks.map((c) => c.text), EMBED_MODEL, { skipBudget: true });

    // Store embeddings using raw SQL (pgvector)
    for (let i = 0; i < chunks.length; i++) {
      const vectorStr = `[${result.embeddings[i].join(",")}]`;
      await prisma.$executeRawUnsafe(
        `UPDATE content_chunks
         SET embedding = $1::vector,
             embedding_status = 'DONE',
             embedding_model = $2,
             embedding_dim = $3,
             embedding_updated_at = NOW()
         WHERE id = $4`,
        vectorStr,
        EMBED_MODEL,
        EMBED_DIM,
        chunks[i].id,
      );
    }

    logger.info("embed.done", { userId, chunkCount: chunks.length });
  } catch (err) {
    // Mark unfinished chunks as failed — job retries re-fetch them because the
    // query above matches any non-DONE status. Chunks already embedded during
    // this attempt keep their DONE status, and FAILED becomes terminal only
    // once the job exhausts its retries.
    await prisma.contentChunk.updateMany({
      where: { id: { in: fetchedIds }, embeddingStatus: { not: "DONE" } },
      data: { embeddingStatus: "FAILED" },
    });
    throw err;
  }
}
