/**
 * EMBED_CHUNK_BATCH job handler.
 *
 * Fetches chunk texts from the DB, generates embeddings via the AI gateway,
 * and stores them as pgvector vectors using raw SQL.
 */
import { prisma } from "../../db";
import { embed, GatewayError, type GatewayContext } from "../../ai/gateway";
import { enqueueJob } from "../queue";
import { logger } from "../../logger";

const EMBED_MODEL = process.env.AI_MODEL_EMBED || "text-embedding-3-small";
const EMBED_DIM = 1536;

/**
 * Per-request limits. OpenAI's embeddings endpoint rejects more than 2,048
 * inputs or about 300k tokens in one request, so a long textbook sent in one
 * call fails on every retry. Slices stay well under both, and smaller
 * requests also finish inside the provider timeout.
 */
export const MAX_INPUTS_PER_REQUEST = 256;
export const MAX_TOKENS_PER_REQUEST = 200_000;

/** Delay past UTC midnight before a deferred batch runs again (budgets reset at midnight). */
const DEFER_PAST_MIDNIGHT_MS = 5 * 60 * 1000;

export interface EmbedChunkBatchPayload {
  chunkIds: string[];
  userId: string;
}

/**
 * Token estimate for request sizing. English averages about 4 characters a
 * token; 3 leaves room for code, formulas and non-Latin scripts.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/**
 * Splits items into request-sized slices, in order: at most `maxInputs`
 * items and `maxTokens` estimated tokens each. An item larger than
 * `maxTokens` on its own still gets a slice of its own.
 */
export function sliceForEmbedding<T extends { text: string }>(
  items: readonly T[],
  maxInputs: number = MAX_INPUTS_PER_REQUEST,
  maxTokens: number = MAX_TOKENS_PER_REQUEST,
): T[][] {
  const slices: T[][] = [];
  let current: T[] = [];
  let tokens = 0;
  for (const item of items) {
    const size = estimateTokens(item.text);
    if (current.length > 0 && (current.length >= maxInputs || tokens + size > maxTokens)) {
      slices.push(current);
      current = [];
      tokens = 0;
    }
    current.push(item);
    tokens += size;
  }
  if (current.length > 0) slices.push(current);
  return slices;
}

/** The next UTC midnight after `now`, plus a few minutes. */
function nextBudgetReset(now = new Date()): Date {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return new Date(midnight + DEFER_PAST_MIDNIGHT_MS);
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
  let embedded = 0;

  try {
    // One request per slice; each slice is stored (DONE) before the next is
    // sent, so a failure part way keeps the finished slices.
    for (const slice of sliceForEmbedding(chunks)) {
      const result = await embed(ctx, slice.map((c) => c.text), EMBED_MODEL, { budget: "upload" });
      if (result.embeddings.length !== slice.length) {
        throw new Error(`Embedding count mismatch: sent ${slice.length}, received ${result.embeddings.length}`);
      }

      // Store embeddings using raw SQL (pgvector)
      for (let i = 0; i < slice.length; i++) {
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
          slice[i].id,
        );
        embedded++;
      }
    }

    logger.info("embed.done", { userId, chunkCount: chunks.length });
  } catch (err) {
    if (err instanceof GatewayError && err.code === "BUDGET_EXCEEDED") {
      // Over the embedding budget: put the rest back to PENDING and run them
      // after the budget resets, instead of burning the job's retries now
      // and leaving them FAILED for good.
      const remainingIds = chunks.slice(embedded).map((c) => c.id);
      await prisma.contentChunk.updateMany({
        where: { id: { in: remainingIds }, embeddingStatus: { not: "DONE" } },
        data: { embeddingStatus: "PENDING" },
      });
      const runAfter = nextBudgetReset();
      await enqueueJob("EMBED_CHUNK_BATCH", { chunkIds: remainingIds, userId }, { runAfter });
      logger.warn("embed.deferred", {
        userId,
        embedded,
        remaining: remainingIds.length,
        runAfter: runAfter.toISOString(),
        reason: err.message,
      });
      return;
    }

    // Mark unfinished chunks as failed. Job retries re-fetch them because the
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
