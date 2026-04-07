import { prisma } from "./db";

export interface SearchParams {
  userId: string;
  q: string;
  namespace: "COURSE" | "RESEARCH";
  courseName?: string;
  examName?: string;
  topK?: number;
}

export interface SearchResult {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  page_number: number | null;
  rank_score: number;
  snippet: string;
}

/**
 * Full-text search over ContentChunks using PostgreSQL tsvector/tsquery.
 *
 * Uses plainto_tsquery for robustness (handles any user input).
 * Ranks with ts_rank_cd and generates highlighted snippets with ts_headline.
 * Always scoped to user_id + namespace; optionally filtered by course/exam.
 */
export async function searchChunks(params: SearchParams): Promise<SearchResult[]> {
  const { userId, q, namespace, courseName, examName, topK = 5 } = params;
  const limit = Math.min(Math.max(topK, 1), 50);

  if (!q.trim()) return [];

  // Build WHERE conditions for the document filter
  const conditions: string[] = [
    `d."user_id" = $1`,
    `d."namespace" = $2`,
  ];
  const values: (string | number)[] = [userId, namespace];
  let paramIdx = 3;

  if (courseName) {
    conditions.push(`d."course_name" = $${paramIdx}`);
    values.push(courseName);
    paramIdx++;
  }
  if (examName) {
    conditions.push(`d."exam_name" = $${paramIdx}`);
    values.push(examName);
    paramIdx++;
  }

  // Only search PROCESSED documents
  conditions.push(`d."status" = 'PROCESSED'`);

  const queryParamIdx = paramIdx;
  values.push(q);
  paramIdx++;

  const limitParamIdx = paramIdx;
  values.push(limit);

  const sql = `
    SELECT
      c.id AS chunk_id,
      d.id AS doc_id,
      d.title AS doc_title,
      c.page_number,
      ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', $${queryParamIdx})) AS rank_score,
      ts_headline('english', c.text, plainto_tsquery('english', $${queryParamIdx}),
        'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=20') AS snippet
    FROM content_chunks c
    JOIN content_documents d ON c.document_id = d.id
    WHERE ${conditions.join(" AND ")}
      AND to_tsvector('english', c.text) @@ plainto_tsquery('english', $${queryParamIdx})
    ORDER BY rank_score DESC
    LIMIT $${limitParamIdx}
  `;

  const rows = await prisma.$queryRawUnsafe<
    {
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      page_number: number | null;
      rank_score: number;
      snippet: string;
    }[]
  >(sql, ...values);

  return rows.map((r) => ({
    chunk_id: r.chunk_id,
    doc_id: r.doc_id,
    doc_title: r.doc_title,
    page_number: r.page_number,
    rank_score: Number(r.rank_score),
    snippet: r.snippet,
  }));
}

// ---------------------------------------------------------------------------
// Vector search (pgvector cosine similarity)
// ---------------------------------------------------------------------------

export interface VectorSearchParams extends Omit<SearchParams, "q"> {
  embedding: number[];
  topK?: number;
}

/**
 * Vector similarity search using pgvector cosine distance.
 * Only returns chunks that have an embedding (status = 'DONE').
 */
export async function vectorSearchChunks(params: VectorSearchParams): Promise<SearchResult[]> {
  const { userId, embedding, namespace, courseName, examName, topK = 5 } = params;
  const limit = Math.min(Math.max(topK, 1), 50);
  const vectorStr = `[${embedding.join(",")}]`;

  const conditions: string[] = [
    `d."user_id" = $1`,
    `d."namespace" = $2`,
    `d."status" = 'PROCESSED'`,
    `c."embedding_status" = 'DONE'`,
  ];
  const values: (string | number)[] = [userId, namespace];
  let paramIdx = 3;

  if (courseName) {
    conditions.push(`d."course_name" = $${paramIdx}`);
    values.push(courseName);
    paramIdx++;
  }
  if (examName) {
    conditions.push(`d."exam_name" = $${paramIdx}`);
    values.push(examName);
    paramIdx++;
  }

  const vecParamIdx = paramIdx;
  values.push(vectorStr as unknown as string);
  paramIdx++;

  const limitParamIdx = paramIdx;
  values.push(limit);

  const sql = `
    SELECT
      c.id AS chunk_id,
      d.id AS doc_id,
      d.title AS doc_title,
      c.page_number,
      1 - (c.embedding <=> $${vecParamIdx}::vector) AS rank_score,
      substring(c.text from 1 for 200) AS snippet
    FROM content_chunks c
    JOIN content_documents d ON c.document_id = d.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY c.embedding <=> $${vecParamIdx}::vector ASC
    LIMIT $${limitParamIdx}
  `;

  const rows = await prisma.$queryRawUnsafe<
    {
      chunk_id: string;
      doc_id: string;
      doc_title: string;
      page_number: number | null;
      rank_score: number;
      snippet: string;
    }[]
  >(sql, ...values);

  return rows.map((r) => ({
    chunk_id: r.chunk_id,
    doc_id: r.doc_id,
    doc_title: r.doc_title,
    page_number: r.page_number,
    rank_score: Number(r.rank_score),
    snippet: r.snippet,
  }));
}

// ---------------------------------------------------------------------------
// Hybrid search with Reciprocal Rank Fusion (RRF)
// ---------------------------------------------------------------------------

export type RetrievalMode = "FTS" | "VECTOR" | "HYBRID";

export interface HybridSearchParams extends SearchParams {
  /** Required for VECTOR or HYBRID mode */
  embedding?: number[];
  mode?: RetrievalMode;
  ftsK?: number;
  vectorK?: number;
  rrfK?: number;
}

/**
 * Reciprocal Rank Fusion — merges ranked lists from FTS and vector search.
 * RRF score = Σ 1 / (k + rank_i) for each ranking list that contains the item.
 */
export function reciprocalRankFusion(
  ftsResults: SearchResult[],
  vecResults: SearchResult[],
  k: number = 60,
): SearchResult[] {
  const scores = new Map<string, { score: number; result: SearchResult }>();

  for (let i = 0; i < ftsResults.length; i++) {
    const r = ftsResults[i];
    const existing = scores.get(r.chunk_id);
    const rrfScore = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrfScore;
    } else {
      scores.set(r.chunk_id, { score: rrfScore, result: r });
    }
  }

  for (let i = 0; i < vecResults.length; i++) {
    const r = vecResults[i];
    const existing = scores.get(r.chunk_id);
    const rrfScore = 1 / (k + i + 1);
    if (existing) {
      existing.score += rrfScore;
      // Prefer FTS snippet (has highlighting) if available
    } else {
      scores.set(r.chunk_id, { score: rrfScore, result: r });
    }
  }

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ score, result }) => ({ ...result, rank_score: score }));
}

/**
 * Hybrid search: runs FTS and vector search, fuses with RRF.
 * Falls back to FTS-only if no embedding is provided or HYBRID_SEARCH_ENABLED is false.
 */
export async function hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
  const {
    mode = process.env.HYBRID_SEARCH_ENABLED === "true" ? "HYBRID" : "FTS",
    embedding,
    ftsK = 10,
    vectorK = 10,
    rrfK = 60,
    topK = 5,
    ...baseParams
  } = params;

  if (mode === "FTS" || !embedding) {
    return searchChunks({ ...baseParams, topK });
  }

  if (mode === "VECTOR") {
    return vectorSearchChunks({ ...baseParams, embedding, topK });
  }

  // HYBRID: run both, fuse with RRF
  const [ftsResults, vecResults] = await Promise.all([
    searchChunks({ ...baseParams, topK: ftsK }),
    vectorSearchChunks({ ...baseParams, embedding, topK: vectorK }),
  ]);

  const fused = reciprocalRankFusion(ftsResults, vecResults, rrfK);
  return fused.slice(0, topK);
}

// ---------------------------------------------------------------------------
// Feedback query builder
// ---------------------------------------------------------------------------

/**
 * Build a search query from attempt context for post-score feedback.
 * Combines prompt text + correction rule + objective title.
 * No LLM dependency — just string concatenation.
 */
export function buildFeedbackQuery(
  promptText: string,
  correctionRule?: string,
  objectiveTitle?: string
): string {
  const parts = [promptText];
  if (correctionRule) parts.push(correctionRule);
  if (objectiveTitle) parts.push(objectiveTitle);
  // Take first ~200 chars to keep the query reasonable
  return parts.join(" ").slice(0, 200);
}
