/**
 * Content-aware plan service.
 *
 * Bridges uploaded course content with the plan generator so the AI
 * can design study sessions grounded in actual course material.
 */
import { prisma } from "@/lib/db";
import { searchChunks, type SearchResult } from "@/lib/search";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { createProvider } from "@/lib/ai/provider-factory";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SuggestedObjective {
  title: string;
  description: string;
  difficulty: number;
  keywords: string[];
}

export interface ContentContext {
  snippets: { chunk_id: string; doc_title: string; page_number: number | null; text: string }[];
  totalChunks: number;
}

export interface ContentAwareMeta {
  hasContent: boolean;
  documentCount: number;
  totalChunks: number;
  topicDifficulty: Record<string, number>;
  contentContext: string;
}

// ---------------------------------------------------------------------------
// 1. extractObjectivesFromContent
// ---------------------------------------------------------------------------

/**
 * Query ContentDocuments for the given course, retrieve their chunks,
 * and use the AI to extract key topics/learning objectives.
 * Used BEFORE plan creation to auto-suggest objectives.
 */
export async function extractObjectivesFromContent(
  userId: string,
  courseName: string,
  examName?: string,
): Promise<SuggestedObjective[]> {
  // Find processed documents for this user + course
  const where: Record<string, unknown> = {
    userId,
    namespace: "COURSE",
    courseName,
    status: "PROCESSED",
  };
  if (examName) where.examName = examName;

  const documents = await prisma.contentDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (documents.length === 0) return [];

  const docIds = documents.map((d) => d.id);

  // Retrieve a representative sample of chunks (first chunks from each doc + spread)
  const chunks = await prisma.contentChunk.findMany({
    where: { documentId: { in: docIds } },
    orderBy: [{ documentId: "asc" }, { ordinal: "asc" }],
    select: { text: true },
    take: 40, // cap to keep prompt size reasonable
  });

  if (chunks.length === 0) return [];

  // Build AI gateway context
  const gatewayCtx: GatewayContext = { userId, provider: createProvider() };

  const chunkTexts = chunks.map((c) => c.text);
  const prompt = getPrompt(AiTask.EXTRACT_OBJECTIVES);

  try {
    const result = await runTask<{ objectives: SuggestedObjective[] }>(gatewayCtx, {
      task: AiTask.EXTRACT_OBJECTIVES,
      model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
      promptVersion: prompt.version,
      input: { chunkTexts, courseName, examName },
      parseOutput: (raw: unknown) => {
        const data = raw as Record<string, unknown>;
        return {
          objectives: (data.objectives as SuggestedObjective[]) || [],
        };
      },
    });

    logger.info("content_plan.objectives_extracted", {
      user_id: userId,
      course_name: courseName,
      count: result.output.objectives.length,
    });

    return result.output.objectives;
  } catch (err) {
    logger.error("content_plan.extract_objectives_failed", {
      user_id: userId,
      course_name: courseName,
      error: String(err),
    });
    return [];
  }
}

// ---------------------------------------------------------------------------
// 2. getContentContextForSession
// ---------------------------------------------------------------------------

/**
 * Given a session's mode and objectives, search the user's uploaded content
 * chunks to find the most relevant content. Returns formatted context that
 * can be used to generate practice questions.
 */
export async function getContentContextForSession(
  userId: string,
  courseName: string,
  mode: string,
  objectives: string[],
  topK: number = 5,
): Promise<ContentContext> {
  // Build a combined query from mode + objectives
  const queryParts = [...objectives];
  if (mode === "ERROR_REPAIR") {
    queryParts.push("common mistakes errors");
  } else if (mode === "EXAM_SIM") {
    queryParts.push("exam practice assessment");
  } else if (mode === "WORKED_EXAMPLES") {
    queryParts.push("examples step-by-step solutions");
  }

  const query = queryParts.join(" ").slice(0, 200);

  const results: SearchResult[] = await searchChunks({
    userId,
    q: query,
    namespace: "COURSE",
    courseName,
    topK,
  });

  // Also count total chunks for the course (useful for metadata)
  const totalChunks = await prisma.contentChunk.count({
    where: {
      document: {
        userId,
        namespace: "COURSE",
        courseName,
        status: "PROCESSED",
      },
    },
  });

  return {
    snippets: results.map((r) => ({
      chunk_id: r.chunk_id,
      doc_title: r.doc_title,
      page_number: r.page_number,
      text: r.snippet,
    })),
    totalChunks,
  };
}

// ---------------------------------------------------------------------------
// 3. buildContentAwarePlanInput
// ---------------------------------------------------------------------------

/**
 * Combine content analysis with the plan creation flow.
 * Queries content to estimate topic difficulty (based on chunk count and
 * complexity signals) and returns metadata that the plan generator can use
 * to allocate more time to harder topics.
 */
export async function buildContentAwarePlanInput(
  userId: string,
  courseName: string,
  examName?: string,
): Promise<ContentAwareMeta> {
  // Find processed documents
  const where: Record<string, unknown> = {
    userId,
    namespace: "COURSE",
    courseName,
    status: "PROCESSED",
  };
  if (examName) where.examName = examName;

  const documents = await prisma.contentDocument.findMany({
    where,
    select: { id: true, title: true },
  });

  if (documents.length === 0) {
    return {
      hasContent: false,
      documentCount: 0,
      totalChunks: 0,
      topicDifficulty: {},
      contentContext: "",
    };
  }

  const docIds = documents.map((d) => d.id);

  // Get all chunks for analysis
  const chunks = await prisma.contentChunk.findMany({
    where: { documentId: { in: docIds } },
    select: { id: true, text: true, documentId: true, pageNumber: true },
  });

  const totalChunks = chunks.length;

  // Estimate topic difficulty based on content density signals:
  // - Average text length per chunk (longer = more complex material)
  // - Number of chunks per document (more chunks = more content to cover)
  const docChunkCounts: Record<string, number> = {};
  const docAvgLength: Record<string, number> = {};
  const docTotalLength: Record<string, number> = {};

  for (const chunk of chunks) {
    docChunkCounts[chunk.documentId] = (docChunkCounts[chunk.documentId] || 0) + 1;
    docTotalLength[chunk.documentId] = (docTotalLength[chunk.documentId] || 0) + chunk.text.length;
  }

  for (const docId of docIds) {
    const count = docChunkCounts[docId] || 0;
    const total = docTotalLength[docId] || 0;
    docAvgLength[docId] = count > 0 ? total / count : 0;
  }

  // Compute per-document difficulty score (1-5) based on chunk count and avg length
  const topicDifficulty: Record<string, number> = {};
  const maxChunks = Math.max(...Object.values(docChunkCounts), 1);
  const maxAvgLen = Math.max(...Object.values(docAvgLength), 1);

  for (const doc of documents) {
    const chunkCount = docChunkCounts[doc.id] || 0;
    const avgLen = docAvgLength[doc.id] || 0;

    // Normalize each signal to 0-1, then combine
    const chunkSignal = chunkCount / maxChunks;
    const lengthSignal = avgLen / maxAvgLen;
    const combined = chunkSignal * 0.6 + lengthSignal * 0.4;

    // Map to 1-5 scale
    topicDifficulty[doc.title] = Math.max(1, Math.min(5, Math.round(combined * 4 + 1)));
  }

  // Build a summary context string for the plan generator
  const contextLines: string[] = [
    `The student has uploaded ${documents.length} document(s) with ${totalChunks} total content chunks.`,
    "",
    "Document overview:",
  ];

  for (const doc of documents) {
    const chunkCount = docChunkCounts[doc.id] || 0;
    const difficulty = topicDifficulty[doc.title] || 1;
    contextLines.push(`- "${doc.title}": ${chunkCount} chunks, estimated difficulty ${difficulty}/5`);
  }

  // Include a sample of content snippets for grounding
  const sampleChunks = chunks.slice(0, 10);
  if (sampleChunks.length > 0) {
    contextLines.push("");
    contextLines.push("Sample content excerpts:");
    for (const chunk of sampleChunks) {
      const preview = chunk.text.slice(0, 150).replace(/\n/g, " ");
      contextLines.push(`  [p.${chunk.pageNumber ?? "?"}] ${preview}...`);
    }
  }

  const contentContext = contextLines.join("\n");

  logger.info("content_plan.metadata_built", {
    user_id: userId,
    course_name: courseName,
    document_count: documents.length,
    total_chunks: totalChunks,
  });

  return {
    hasContent: true,
    documentCount: documents.length,
    totalChunks,
    topicDifficulty,
    contentContext,
  };
}
