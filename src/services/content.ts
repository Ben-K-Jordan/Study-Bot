import { prisma } from "@/lib/db";
import { sha256, saveFile, resolveStoragePath } from "@/lib/storage";
import { extractDocumentText } from "@/lib/extractor";
import { chunkText } from "@/lib/chunker";
import { searchChunks, buildFeedbackQuery, type SearchResult } from "@/lib/search";
import { enqueueJob } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";

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

  // Create document record first to get the ID for storage key
  const doc = await prisma.contentDocument.create({
    data: {
      userId,
      namespace,
      courseName: courseName ?? null,
      examName: examName ?? null,
      title,
      originalFilename,
      mimeType,
      storageKey: "", // will update after saving
      contentHash,
      status: "UPLOADED",
    },
  });

  // Save file to disk
  const storageKey = await saveFile(userId, doc.id, originalFilename, fileData);

  // Update storage key
  await prisma.contentDocument.update({
    where: { id: doc.id },
    data: { storageKey },
  });

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
    const chunkIds: string[] = [];
    await prisma.$transaction(async (tx) => {
      // Delete any existing chunks (from a previous failed attempt)
      await tx.contentChunk.deleteMany({ where: { documentId: doc.id } });

      // Batch insert chunks with embedding status PENDING
      for (const chunk of chunks) {
        const created = await tx.contentChunk.create({
          data: {
            documentId: doc.id,
            ordinal: chunk.ordinal,
            pageNumber: chunk.pageNumber,
            text: chunk.text,
            textHash: chunk.textHash,
            embeddingStatus: "PENDING",
          },
        });
        chunkIds.push(created.id);
      }

      await tx.contentDocument.update({
        where: { id: doc.id },
        data: { status: "PROCESSED" },
      });

      // Enqueue embedding job within the same transaction
      await enqueueJob("EMBED_CHUNK_BATCH", { chunkIds, userId }, {}, tx);
    });

    logger.info("document.processed", {
      user_id: userId,
      document_id: doc.id,
      chunk_count: chunks.length,
    });

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

async function storeCitations(
  attemptId: string,
  results: SearchResult[]
): Promise<FeedbackExcerpt[]> {
  const excerpts: FeedbackExcerpt[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    // Upsert to handle idempotent calls
    await prisma.attemptCitation.upsert({
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
    });

    excerpts.push({
      chunk_id: r.chunk_id,
      doc_title: r.doc_title,
      page_number: r.page_number,
      snippet: r.snippet,
      rank: i + 1,
    });
  }

  return excerpts;
}
