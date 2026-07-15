import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { sha256, saveFile, resolveStoragePath } from "@/lib/storage";
import { extractDocumentText } from "@/lib/extractor";
import { chunkText } from "@/lib/chunker";
import { searchChunks, buildFeedbackQuery, type SearchResult } from "@/lib/search";
import { enqueueJob } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import { runTask, type GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";

// ---- Document Upload ----

export interface UploadResult {
  document_id: string;
  status: string;
  deduped: boolean;
}

export async function uploadDocument(
  userId: string,
  namespace: string,
  courseName: string | undefined,
  examName: string | undefined,
  title: string,
  originalFilename: string,
  mimeType: string,
  fileData: Buffer
): Promise<UploadResult> {
  const contentHash = sha256(fileData);

  // Check dedupe: same user + same content hash
  const existing = await prisma.contentDocument.findUnique({
    where: { userId_contentHash: { userId, contentHash } },
  });

  if (existing) {
    return {
      document_id: existing.id,
      status: existing.status,
      deduped: true,
    };
  }

  // Save the file to disk FIRST, then create the DB row. If the row were
  // created first and saveFile failed, the broken row (empty storageKey)
  // would permanently satisfy the dedupe check for this content hash.
  // The storage key needs a document ID, so generate it up front.
  const documentId = randomUUID();
  const storageKey = await saveFile(userId, documentId, originalFilename, fileData);

  let doc;
  try {
    doc = await prisma.contentDocument.create({
      data: {
        id: documentId,
        userId,
        namespace,
        courseName: courseName ?? null,
        examName: examName ?? null,
        title,
        originalFilename,
        mimeType,
        storageKey,
        contentHash,
        status: "UPLOADED",
      },
    });
  } catch (err: unknown) {
    // Unique constraint violation (P2002) — a concurrent upload of the same
    // file won the race. Return the winning row as a dedupe hit.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "P2002"
    ) {
      const winner = await prisma.contentDocument.findUnique({
        where: { userId_contentHash: { userId, contentHash } },
      });
      if (winner) {
        return {
          document_id: winner.id,
          status: winner.status,
          deduped: true,
        };
      }
    }
    throw err;
  }

  logger.info("document.uploaded", {
    user_id: userId,
    document_id: doc.id,
    namespace,
    filename: originalFilename,
  });

  return {
    document_id: doc.id,
    status: "UPLOADED",
    deduped: false,
  };
}

// ---- Document Processing ----

export async function processDocument(userId: string, documentId: string) {
  const doc = await prisma.contentDocument.findUnique({
    where: { id: documentId },
  });

  if (!doc) return { error: "not_found" as const };
  if (doc.userId !== userId) return { error: "forbidden" as const };

  // Idempotent: if already processed, return counts
  if (doc.status === "PROCESSED") {
    const chunkCount = await prisma.contentChunk.count({
      where: { documentId: doc.id },
    });
    return {
      data: {
        document_id: doc.id,
        status: "PROCESSED",
        chunk_count: chunkCount,
      },
    };
  }

  try {
    const filePath = resolveStoragePath(doc.storageKey);
    const extraction = await extractDocumentText(filePath, doc.mimeType);
    const chunks = chunkText(extraction.fullText, extraction.pages);

    // Insert chunks in a transaction, then enqueue embedding job
    await prisma.$transaction(async (tx) => {
      // Delete any existing chunks (from a previous failed attempt)
      await tx.contentChunk.deleteMany({ where: { documentId: doc.id } });

      // Batch insert chunks with embedding status PENDING
      await tx.contentChunk.createMany({
        data: chunks.map((chunk) => ({
          documentId: doc.id,
          ordinal: chunk.ordinal,
          pageNumber: chunk.pageNumber,
          text: chunk.text,
          textHash: chunk.textHash,
          embeddingStatus: "PENDING",
        })),
      });

      await tx.contentDocument.update({
        where: { id: doc.id },
        data: { status: "PROCESSED" },
      });

      // Fetch inserted chunk IDs for the embedding job
      const inserted = await tx.contentChunk.findMany({
        where: { documentId: doc.id },
        select: { id: true },
        orderBy: { ordinal: "asc" },
      });
      const chunkIds = inserted.map((c) => c.id);

      // Enqueue embedding job within the same transaction
      await enqueueJob("EMBED_CHUNK_BATCH", { chunkIds, userId }, {}, tx);
    });

    logger.info("document.processed", {
      user_id: userId,
      document_id: doc.id,
      chunk_count: chunks.length,
    });

    // Generate document summary (awaited to prevent data loss on process exit)
    try {
      await generateDocumentSummary(userId, doc.id, doc.title, doc.courseName, doc.examName, chunks.map((c) => c.text));
    } catch (summaryErr) {
      // Summary is non-critical — log and continue
      logger.error("document.summary_failed", { document_id: doc.id, error: String(summaryErr) });
    }

    return {
      data: {
        document_id: doc.id,
        status: "PROCESSED",
        chunk_count: chunks.length,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown processing error";
    await prisma.contentDocument.update({
      where: { id: doc.id },
      data: { status: "FAILED", errorMessage: msg },
    });
    captureException(err, { user_id: userId, document_id: doc.id });
    return {
      data: {
        document_id: doc.id,
        status: "FAILED",
        chunk_count: 0,
      },
    };
  }
}

// ---- List Documents ----

export async function listDocuments(
  userId: string,
  namespace?: string,
  courseName?: string,
  examName?: string
) {
  const where: Record<string, unknown> = { userId };
  if (namespace) where.namespace = namespace;
  if (courseName) where.courseName = courseName;
  if (examName) where.examName = examName;

  const docs = await prisma.contentDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { chunks: true } } },
  });

  return docs.map((d) => ({
    document_id: d.id,
    namespace: d.namespace,
    course_name: d.courseName,
    exam_name: d.examName,
    title: d.title,
    original_filename: d.originalFilename,
    status: d.status,
    chunk_count: d._count.chunks,
    summary: d.summary ?? null,
    suggested_questions: (d.suggestedQuestions as string[] | null) ?? null,
    created_at: d.createdAt.toISOString(),
  }));
}

// ---- Post-Score Feedback ----

export interface FeedbackExcerpt {
  chunk_id: string;
  doc_title: string;
  page_number: number | null;
  snippet: string;
  rank: number;
}

/**
 * Fetch post-score feedback excerpts from the user's course materials.
 * Only called for PARTIAL/INCORRECT scores.
 * Search + citation storage happens OUTSIDE the attempt transaction.
 */
export async function fetchFeedbackExcerpts(
  userId: string,
  attemptId: string,
  promptText: string,
  courseName: string,
  examName: string,
  correctionRule?: string,
  objectiveTitle?: string
): Promise<FeedbackExcerpt[]> {
  try {
    const query = buildFeedbackQuery(promptText, correctionRule, objectiveTitle);

    const results: SearchResult[] = await searchChunks({
      userId,
      q: query,
      namespace: "COURSE",
      courseName,
      examName,
      topK: 5,
    });

    if (results.length === 0) {
      // Try without exam_name filter for broader results
      const broaderResults = await searchChunks({
        userId,
        q: query,
        namespace: "COURSE",
        courseName,
        topK: 5,
      });
      if (broaderResults.length === 0) return [];
      return await storeCitations(attemptId, broaderResults);
    }

    return await storeCitations(attemptId, results);
  } catch (err: unknown) {
    // Feedback failure must not fail the attempt
    captureException(err, { user_id: userId, attempt_id: attemptId, action: "fetchFeedback" });
    logger.error("feedback.failed", { user_id: userId, attempt_id: attemptId, error: String(err) });
    return [];
  }
}

// ---- Document Summary Generation ----

const SUMMARY_MODEL = process.env.AI_MODEL_ANSWER || "gpt-4o-mini";

async function generateDocumentSummary(
  userId: string,
  documentId: string,
  title: string,
  courseName: string | null,
  examName: string | null,
  chunkTexts: string[],
): Promise<void> {
  const providerName = process.env.AI_PROVIDER || "mock";
  if (providerName === "mock") return;

  // Use a sample of chunks (first 8) to keep token usage reasonable
  const sampleTexts = chunkTexts.slice(0, 8);
  if (sampleTexts.length === 0) return;

  const ctx: GatewayContext = { userId, provider: createProvider() };
  const prompt = getPrompt(AiTask.SUMMARIZE_DOCUMENT);

  const result = await runTask<{ summary: string; suggested_questions: string[] }>(ctx, {
    task: AiTask.SUMMARIZE_DOCUMENT,
    promptVersion: prompt.version,
    model: SUMMARY_MODEL,
    input: {
      title,
      courseName: courseName || undefined,
      examName: examName || undefined,
      chunkTexts: sampleTexts,
    },
    parseOutput: (raw: unknown) => {
      const data = raw as Record<string, unknown>;
      return {
        summary: (data.summary as string) || "",
        suggested_questions: (data.suggested_questions as string[]) || [],
      };
    },
  });

  if (result.output.summary) {
    await prisma.contentDocument.update({
      where: { id: documentId },
      data: {
        summary: result.output.summary,
        suggestedQuestions: result.output.suggested_questions,
      },
    });

    logger.info("document.summary_generated", {
      document_id: documentId,
      questions_count: result.output.suggested_questions.length,
    });
  }
}

async function storeCitations(
  attemptId: string,
  results: SearchResult[]
): Promise<FeedbackExcerpt[]> {
  // Run all upserts in parallel
  await Promise.all(
    results.map((r, i) =>
      prisma.attemptCitation.upsert({
        where: {
          attemptId_chunkId: { attemptId, chunkId: r.chunk_id },
        },
        create: {
          attemptId,
          chunkId: r.chunk_id,
          rank: i + 1,
          snippet: r.snippet,
        },
        update: {
          rank: i + 1,
          snippet: r.snippet,
        },
      })
    )
  );

  return results.map((r, i) => ({
    chunk_id: r.chunk_id,
    doc_title: r.doc_title,
    page_number: r.page_number,
    snippet: r.snippet,
    rank: i + 1,
  }));
}
