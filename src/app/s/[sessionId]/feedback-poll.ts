/**
 * Deferred-feedback polling client, shared by the runner screens.
 *
 * Plain .ts module (no JSX) so the poll contract is unit-testable: PENDING
 * is the only non-terminal status — any other result (content, explicit
 * no_sources, UNAVAILABLE) resolves immediately, and the poll budget yields
 * null instead of spinning forever.
 */

export interface FeedbackExcerpt {
  chunk_id: string;
  doc_title: string;
  page_number: number | null;
  snippet: string;
  rank: number;
}

export interface FeedbackResult {
  status: string;
  excerpts: FeedbackExcerpt[];
  /** Server-persisted terminal marker: nothing matching in the materials. */
  no_sources?: boolean;
  // AI explanation (wrong/partial)
  explanation?: string;
  key_takeaway?: string;
  // Concept connections (all scores)
  concept_connection?: string;
  // Mnemonic (wrong/partial)
  mnemonic?: string;
  // Mistake pattern advice
  pattern_advice?: string;
  // Reinforcement (correct)
  reinforcement?: string;
  deeper_insight?: string;
  // Socratic follow-up (all scores)
  socratic_followup?: string;
  socratic_purpose?: string;
}

/** Fetch deferred feedback for an attempt */
async function fetchFeedback(attemptId: string): Promise<FeedbackResult> {
  const res = await fetch(`/api/attempts/${attemptId}/feedback`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

/**
 * Poll feedback until generation completes. The server generates feedback
 * eagerly at submit time; PENDING means another worker owns generation, so
 * we poll instead of duplicating the AI calls. Returns null when cancelled
 * or when the poll budget runs out while still PENDING.
 */
export async function pollFeedback(
  attemptId: string,
  isCancelled: () => boolean,
  maxAttempts = 25,
  intervalMs = 1000
): Promise<FeedbackResult | null> {
  for (let i = 0; i < maxAttempts; i++) {
    if (isCancelled()) return null;
    const result = await fetchFeedback(attemptId);
    if (result.status !== "PENDING") return result;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}
