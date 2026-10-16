import { prisma } from "./db";
import { Prisma } from "../../generated/prisma/client";

/**
 * How the query's words must appear in a chunk.
 * - "all": every word in one chunk (plainto_tsquery). Right for short,
 *   precise queries such as a topic title.
 * - "any": any of the words, ranked by how many and how often they appear,
 *   with a floor so a stray shared word never becomes a citation. Right for
 *   natural-language questions, where a passage that answers the question
 *   rarely repeats every word of it.
 */
export type SearchMatch = "all" | "any";

export interface SearchParams {
  userId: string;
  q: string;
  namespace: "COURSE" | "RESEARCH";
  courseName?: string;
  examName?: string;
  topK?: number;
  /** Defaults to "all". */
  match?: SearchMatch;
}

/**
 * The floor an any-word hit must clear, unless it holds every query word:
 * at least this many distinct query words (or all of them, for shorter
 * queries), a cover-density rank of at least MIN_RANK (about five matching
 * word occurrences), and at least RELATIVE_RANK of the best hit's rank.
 */
export const ANY_MATCH_FLOOR = { MIN_WORDS: 2, MIN_RANK: 0.5, RELATIVE_RANK: 0.5 } as const;

export interface SearchResult {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  page_number: number | null;
  rank_score: number;
  snippet: string;
}

/**
 * Build reusable WHERE conditions for document-scoped queries.
 * Uses Prisma.sql tagged templates for safe parameterization.
 */
function buildDocConditions(
  userId: string,
  namespace: string,
  courseName?: string,
  examName?: string,
): Prisma.Sql {
  const parts: Prisma.Sql[] = [
    Prisma.sql`d."user_id" = ${userId}`,
    Prisma.sql`d."namespace" = ${namespace}`,
    Prisma.sql`d."status" = 'PROCESSED'`,
  ];

  if (courseName) {
    parts.push(Prisma.sql`d."course_name" = ${courseName}`);
  }
  if (examName) {
    parts.push(Prisma.sql`d."exam_name" = ${examName}`);
  }

  return Prisma.join(parts, " AND ");
}

type SearchRow = {
  chunk_id: string;
  doc_id: string;
  doc_title: string;
  page_number: number | null;
  rank_score: number;
  snippet: string;
};

/**
 * Full-text search over ContentChunks using PostgreSQL tsvector/tsquery.
 *
 * Parses the query with plainto_tsquery for robustness (handles any user
 * input). match "all" requires every word in one chunk; match "any" ORs the
 * same lexemes and keeps a hit only when it holds every word or clears
 * ANY_MATCH_FLOOR. Ranks with ts_rank_cd and generates highlighted snippets
 * with ts_headline. Always scoped to user_id + namespace; optionally
 * filtered by course/exam.
 */
export async function searchChunks(params: SearchParams): Promise<SearchResult[]> {
  const { userId, q, namespace, courseName, examName, topK = 5, match = "all" } = params;
  const limit = Math.min(Math.max(topK, 1), 50);

  if (!q.trim()) return [];

  const conditions = buildDocConditions(userId, namespace, courseName, examName);

  const rows =
    match === "any"
      ? await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    WITH q AS (
      -- The same stemmed lexemes plainto_tsquery finds, joined with OR. A
      -- query of only stop words yields an empty tsquery, which matches nothing.
      SELECT
        replace(plainto_tsquery('english', ${q})::text, ' & ', ' | ')::tsquery AS query,
        tsvector_to_array(to_tsvector('english', ${q})) AS lexemes
    ),
    hits AS (
      SELECT
        c.id AS chunk_id,
        d.id AS doc_id,
        d.title AS doc_title,
        c.page_number,
        c.text,
        ts_rank_cd(to_tsvector('english', c.text), q.query) AS rank_score,
        cardinality(ARRAY(
          SELECT unnest(tsvector_to_array(to_tsvector('english', c.text)))
          INTERSECT
          SELECT unnest(q.lexemes)
        )) AS matched,
        cardinality(q.lexemes) AS wanted
      FROM content_chunks c
      JOIN content_documents d ON c.document_id = d.id
      CROSS JOIN q
      WHERE ${conditions}
        AND to_tsvector('english', c.text) @@ q.query
    ),
    ranked AS (
      SELECT hits.*, max(rank_score) OVER () AS best FROM hits
    )
    SELECT
      chunk_id,
      doc_id,
      doc_title,
      page_number,
      rank_score,
      ts_headline('english', text, (SELECT query FROM q),
        'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=20') AS snippet
    FROM ranked
    WHERE matched >= wanted
      OR (
        matched >= LEAST(${ANY_MATCH_FLOOR.MIN_WORDS}::int, wanted)
        AND rank_score >= ${ANY_MATCH_FLOOR.MIN_RANK}::float8
        AND rank_score >= best * ${ANY_MATCH_FLOOR.RELATIVE_RANK}::float8
      )
    ORDER BY rank_score DESC
    LIMIT ${limit}
  `)
      : await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      c.id AS chunk_id,
      d.id AS doc_id,
      d.title AS doc_title,
      c.page_number,
      ts_rank_cd(to_tsvector('english', c.text), plainto_tsquery('english', ${q})) AS rank_score,
      ts_headline('english', c.text, plainto_tsquery('english', ${q}),
        'StartSel=<<, StopSel=>>, MaxWords=40, MinWords=20') AS snippet
    FROM content_chunks c
    JOIN content_documents d ON c.document_id = d.id
    WHERE ${conditions}
      AND to_tsvector('english', c.text) @@ plainto_tsquery('english', ${q})
    ORDER BY rank_score DESC
    LIMIT ${limit}
  `);

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

  const baseConditions = buildDocConditions(userId, namespace, courseName, examName);

  const rows = await prisma.$queryRaw<SearchRow[]>(Prisma.sql`
    SELECT
      c.id AS chunk_id,
      d.id AS doc_id,
      d.title AS doc_title,
      c.page_number,
      1 - (c.embedding <=> ${vectorStr}::vector) AS rank_score,
      substring(c.text from 1 for 200) AS snippet
    FROM content_chunks c
    JOIN content_documents d ON c.document_id = d.id
    WHERE ${baseConditions}
      AND c."embedding_status" = 'DONE'
    ORDER BY c.embedding <=> ${vectorStr}::vector ASC
    LIMIT ${limit}
  `);

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
 * Its full-text half matches any of the question's words (match "any"),
 * because callers pass a natural-language question; pass match "all" to
 * require every word.
 */
export async function hybridSearch(params: HybridSearchParams): Promise<SearchResult[]> {
  const {
    mode = process.env.HYBRID_SEARCH_ENABLED === "true" ? "HYBRID" : "FTS",
    embedding,
    ftsK = 10,
    vectorK = 10,
    rrfK = 60,
    topK = 5,
    match = "any",
    ...rest
  } = params;
  const baseParams = { ...rest, match };

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

const MAX_FEEDBACK_QUERY_CHARS = 200;

/**
 * Wording the app's own question templates add around a topic (prompts.ts,
 * the pretest, review and repair questions in run.ts, worked examples). It
 * says how to answer, not what the question is about, so it only adds
 * words an unrelated passage could share.
 */
const QUESTION_TEMPLATE_WORDING: readonly RegExp[] = [
  /\b(?:Pretest|From memory):\s*/gi,
  /\bExplain as much as you can from memory\.?/gi,
  /\bYou last studied it [^.\n]*\./gi,
  /\b(?:and )?what matters most to remember about it\b/gi,
  /\bin 3 to 5 bullets\b/gi,
  /\b(?:and )?give one concrete example\b/gi,
  /\bList the key steps involved in\b/gi,
  /\bWhat are the most common pitfalls when applying\b/gi,
  /\bOutline how you would explain\b/gi,
  /\bto a classmate\b/gi,
  /\bCompare and contrast two aspects of\b/gi,
  /\bwhat do you already know about\b/gi,
  /\bYou answered this incorrectly [^.\n]*\./gi,
  /\banswer this similar question you wrote[^.\n]*\./gi,
  /\bstate the correction rule[^.\n]*\./gi,
  /\bThe (?:final|last) (?:two )?steps? (?:is|are) missing[^\n]*/gi,
];

/** A question with the app's template wording taken out, whitespace collapsed. */
export function questionSearchText(promptText: string): string {
  let text = promptText;
  for (const pattern of QUESTION_TEMPLATE_WORDING) text = text.replace(pattern, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Build a search query from attempt context for post-score feedback:
 * the topic title first (the most specific words), then the student's
 * correction rule, then the question without its template wording.
 * Capped at about 200 characters on a word boundary, so the title is never
 * the part cut off. No LLM dependency, just string assembly. Search it with
 * match "any": a passage that answers the question rarely holds every word.
 */
export function buildFeedbackQuery(
  promptText: string,
  correctionRule?: string | null,
  objectiveTitle?: string | null
): string {
  const parts = [objectiveTitle?.trim(), correctionRule?.trim(), questionSearchText(promptText)].filter(
    (part): part is string => Boolean(part)
  );
  const query = parts.join(" ");
  if (query.length <= MAX_FEEDBACK_QUERY_CHARS) return query;
  const cut = query.slice(0, MAX_FEEDBACK_QUERY_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // A word cut in half becomes a lexeme no passage contains.
  return lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
}
