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

  // Fetch chunks that still need embedding
  const chunks = await prisma.contentChunk.findMany({
    where: {
      id: { in: chunkIds },
      embeddingStatus: { in: ["PENDING", "NONE"] },
    },
    select: { id: true, text: true },
  });

  if (chunks.length === 0) {
    logger.info("embed.skip", { reason: "no_pending_chunks", chunkIds });
    return;
  }

  // Mark as IN_PROGRESS
  await prisma.contentChunk.updateMany({
    where: { id: { in: chunks.map((c) => c.id) } },
    data: { embeddingStatus: "IN_PROGRESS" },
  });

  const ctx: GatewayContext = { userId, provider };
  const texts = chunks.map((c) => c.text);

  try {
    const result = await embed(ctx, texts, EMBED_MODEL, { skipBudget: true });

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
    // Mark chunks as failed so they can be retried
    await prisma.contentChunk.updateMany({
      where: { id: { in: chunks.map((c) => c.id) } },
      data: { embeddingStatus: "FAILED" },
    });
    throw err; // Let the worker handle retry logic
  }
}
