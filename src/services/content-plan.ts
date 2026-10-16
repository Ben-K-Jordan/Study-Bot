/**
 * Content-aware plan service.
 *
 * Bridges uploaded course content with the plan generator so the AI
 * can design study sessions grounded in actual course material.
 */
import { prisma } from "@/lib/db";
import { searchChunks, type SearchParams, type SearchResult } from "@/lib/search";
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
// Which documents a plan reads
// ---------------------------------------------------------------------------

/**
 * The processed documents a plan should read. The files picked for the plan
 * (`documentIds`) win, so a file first uploaded under another course still
 * counts. Without them: the course's files for this exam, else all of the
 * course's files, since many students tag files with the course only.
 */
async function findPlanDocuments(
  userId: string,
  courseName: string,
  examName: string | undefined,
  documentIds: string[] | undefined,
): Promise<{ id: string; title: string }[]> {
  const select = { id: true, title: true } as const;
  if (documentIds && documentIds.length > 0) {
    const picked = await prisma.contentDocument.findMany({
      where: { userId, id: { in: documentIds }, status: "PROCESSED" },
      orderBy: { createdAt: "desc" },
      select,
    });
    if (picked.length > 0) return picked;
  }

  const base = { userId, namespace: "COURSE", courseName, status: "PROCESSED" };
  if (examName) {
    const forExam = await prisma.contentDocument.findMany({
      where: { ...base, examName },
      orderBy: { createdAt: "desc" },
      select,
    });
    if (forExam.length > 0) return forExam;
  }
  return prisma.contentDocument.findMany({
    where: base,
    orderBy: { createdAt: "desc" },
    select,
  });
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
  documentIds?: string[],
): Promise<SuggestedObjective[]> {
  const documents = await findPlanDocuments(userId, courseName, examName, documentIds);

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

/** Objectives searched for one session, so a long list can't fan out into dozens of queries. */
const MAX_OBJECTIVES_SEARCHED = 8;
/** Words tried one at a time when an objective's full title matches nothing. */
const MAX_FALLBACK_WORDS = 3;
const STOP_WORDS = new Set([
  "and", "the", "for", "with", "from", "into", "onto", "that", "this", "their", "your",
  "how", "what", "when", "why", "use", "using", "understand", "understanding", "explain", "describe",
  "apply", "identify", "review", "basics", "intro", "introduction", "about", "its",
]);

/** An objective title's most specific words (longest first), for the any-word fallback. */
export function fallbackWords(title: string): string[] {
  const words = title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, MAX_FALLBACK_WORDS);
}

/**
 * Chunks for one objective. Full-text search ANDs every word, so the whole
 * title is tried first: in the exam's files when there is an exam, then in
 * all of the course's files. When nothing matches, each of its main words is
 * searched on its own across the course, and a chunk matching more of them
 * ranks higher (an any-word match). At most 5 queries per objective.
 */
async function searchObjective(
  base: Omit<SearchParams, "q" | "topK" | "examName">,
  title: string,
  topK: number,
  examName: string | undefined,
): Promise<SearchResult[]> {
  if (examName) {
    const scoped = await searchChunks({ ...base, examName, q: title, topK });
    if (scoped.length > 0) return scoped;
  }
  const exact = await searchChunks({ ...base, q: title, topK });
  if (exact.length > 0) return exact;

  const perWord = await Promise.all(
    fallbackWords(title).map((word) => searchChunks({ ...base, q: word, topK })),
  );
  const scored = new Map<string, SearchResult>();
  for (const results of perWord) {
    for (const result of results) {
      const seen = scored.get(result.chunk_id);
      scored.set(
        result.chunk_id,
        seen ? { ...seen, rank_score: seen.rank_score + result.rank_score } : result,
      );
    }
  }
  return [...scored.values()].sort((a, b) => b.rank_score - a.rank_score).slice(0, topK);
}

/** Takes one result from each list in turn, skipping chunks already taken, up to `limit`. */
export function mergeRoundRobin(lists: readonly SearchResult[][], limit: number): SearchResult[] {
  const merged: SearchResult[] = [];
  const seen = new Set<string>();
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let i = 0; i < longest && merged.length < limit; i++) {
    for (const list of lists) {
      const result = list[i];
      if (!result || seen.has(result.chunk_id)) continue;
      seen.add(result.chunk_id);
      merged.push(result);
      if (merged.length >= limit) break;
    }
  }
  return merged;
}

/**
 * The course passages a session's questions are written from. Each
 * objective is searched on its own: one search over every objective title
 * would need a single chunk to hold every word, which almost never happens,
 * and the session then fell back to template questions. Results are taken
 * from each objective in turn, without repeats, up to `topK`. With an exam,
 * an objective is searched in that exam's files first and in all of the
 * course's files when they have nothing on it, as feedback does.
 *
 * `mode` no longer changes the search: words like "exam practice" only
 * narrowed an already narrow match.
 */
export async function getContentContextForSession(
  userId: string,
  courseName: string,
  _mode: string,
  objectives: string[],
  topK: number = 5,
  options: { examName?: string } = {},
): Promise<ContentContext> {
  const titles = [...new Set(objectives.map((o) => o.trim()).filter(Boolean))].slice(
    0,
    MAX_OBJECTIVES_SEARCHED,
  );
  const perObjective = titles.length > 0 ? Math.max(2, Math.ceil(topK / titles.length)) : 0;
  const base = { userId, namespace: "COURSE" as const, courseName };
  const examName = options.examName?.trim() || undefined;

  const [lists, totalChunks] = await Promise.all([
    Promise.all(titles.map((title) => searchObjective(base, title, perObjective, examName))),
    // Also count total chunks for the course (useful for metadata)
    prisma.contentChunk.count({
      where: {
        document: {
          userId,
          namespace: "COURSE",
          courseName,
          status: "PROCESSED",
        },
      },
    }),
  ]);

  const results = mergeRoundRobin(lists, topK);

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
  documentIds?: string[],
): Promise<ContentAwareMeta> {
  const documents = await findPlanDocuments(userId, courseName, examName, documentIds);

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

  // Get chunks for analysis (capped to prevent unbounded memory usage)
  const chunks = await prisma.contentChunk.findMany({
    where: { documentId: { in: docIds } },
    select: { id: true, text: true, documentId: true, pageNumber: true },
    take: 500,
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
