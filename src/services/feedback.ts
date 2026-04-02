import { prisma } from "@/lib/db";
import { searchChunks, buildFeedbackQuery, type SearchResult } from "@/lib/search";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import type { FeedbackExcerpt } from "@/services/content";

/**
 * Generate feedback for a scored attempt. Called via the deferred feedback endpoint.
 *
 * 1. If citations already exist, return them (idempotent).
 * 2. Otherwise, check objective anchors first, then fall back to FTS.
 * 3. Store AttemptCitation rows and return excerpts.
 * 4. On failure, return { status: "UNAVAILABLE" } — never throw.
 */
export async function generateFeedback(
  userId: string,
  attemptId: string
): Promise<{ status: "OK" | "UNAVAILABLE"; excerpts: FeedbackExcerpt[] }> {
  const ftsStart = Date.now();

  try {
    // Load attempt with run + session context
    const attempt = await prisma.sessionAttempt.findUnique({
      where: { id: attemptId },
      include: {
        run: {
          include: {
            session: {
              select: { courseName: true, examName: true, objectives: true },
            },
          },
        },
        citations: {
          include: {
            chunk: {
              include: { document: { select: { title: true } } },
            },
          },
          orderBy: { rank: "asc" },
        },
      },
    });

    if (!attempt) return { status: "UNAVAILABLE", excerpts: [] };
    if (attempt.run.userId !== userId) return { status: "UNAVAILABLE", excerpts: [] };

    // Idempotent: if citations already exist, return them
    if (attempt.citations.length > 0) {
      const excerpts: FeedbackExcerpt[] = attempt.citations.map((c) => ({
        chunk_id: c.chunkId,
        doc_title: c.chunk.document.title,
        page_number: c.chunk.pageNumber,
        snippet: c.snippet,
        rank: c.rank,
      }));
      logger.info("feedback.cached", { attempt_id: attemptId, count: excerpts.length });
      return { status: "OK", excerpts };
    }

    // Only generate feedback for PARTIAL/INCORRECT
    if (attempt.selfScore === "CORRECT" || attempt.selfScore === null) {
      return { status: "OK", excerpts: [] };
    }

    const session = attempt.run.session;
    const courseName = session.courseName;
    const examName = session.examName;

    // Get error log for this attempt (correction rule + variant question)
    const errorLog = await prisma.sessionErrorLog.findFirst({
      where: { runId: attempt.runId, promptIndex: attempt.promptIndex },
    });

    // Get objective title if the prompt has an objective_id
    const promptRow = await prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId: attempt.runId, promptIndex: attempt.promptIndex } },
    });
    const objectives = session.objectives as { id: string; title: string }[] | null;
    const objectiveTitle = promptRow?.objectiveId
      ? objectives?.find((o) => o.id === promptRow.objectiveId)?.title
      : objectives?.[0]?.title;

    // Phase 3: Try objective anchors first
    let results: SearchResult[] = [];
    if (promptRow?.objectiveId) {
      results = await tryObjectiveAnchors(
        userId, courseName, examName, promptRow.objectiveId
      );
    }

    // Fall back to FTS if anchors returned nothing
    if (results.length === 0) {
      const query = buildFeedbackQuery(
        attempt.promptText,
        errorLog?.correctionRule,
        objectiveTitle
      );

      results = await searchChunks({
        userId,
        q: query,
        namespace: "COURSE",
        courseName,
        examName,
        topK: 5,
      });

      if (results.length === 0) {
        // Broader search without exam filter
        results = await searchChunks({
          userId,
          q: query,
          namespace: "COURSE",
          courseName,
          topK: 5,
        });
      }
    }

    const ftsMs = Date.now() - ftsStart;

    if (results.length === 0) {
      logger.info("feedback.empty", { attempt_id: attemptId, fts_ms: ftsMs });
      return { status: "OK", excerpts: [] };
    }

    // Store citations
    const excerpts: FeedbackExcerpt[] = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
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

    logger.info("feedback.generated", {
      attempt_id: attemptId,
      count: excerpts.length,
      fts_ms: ftsMs,
    });

    return { status: "OK", excerpts };
  } catch (err: unknown) {
    captureException(err, { user_id: userId, attempt_id: attemptId, action: "generateFeedback" });
    logger.error("feedback.failed", { user_id: userId, attempt_id: attemptId, error: String(err) });
    return { status: "UNAVAILABLE", excerpts: [] };
  }
}

/**
 * Try to get feedback from precomputed objective anchors (Phase 3).
 * Returns SearchResult-shaped data from cached chunks.
 */
async function tryObjectiveAnchors(
  userId: string,
  courseName: string,
  examName: string,
  objectiveId: string
): Promise<SearchResult[]> {
  try {
    const anchors = await prisma.objectiveAnchor.findMany({
      where: { userId, courseName, examName, objectiveId },
      orderBy: { rank: "asc" },
      take: 5,
      include: {
        chunk: {
          include: { document: { select: { id: true, title: true } } },
        },
      },
    });

    if (anchors.length === 0) return [];

    return anchors.map((a) => ({
      chunk_id: a.chunkId,
      doc_id: a.chunk.document.id,
      doc_title: a.chunk.document.title,
      page_number: a.chunk.pageNumber,
      rank_score: 1.0 / a.rank,
      snippet: a.chunk.text.slice(0, 300),
    }));
  } catch (err) {
    logger.error("feedback.anchor_lookup_failed", { error: String(err) });
    return [];
  }
}
