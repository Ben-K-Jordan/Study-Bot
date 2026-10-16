"use client";

import { apiGet } from "@/lib/client-api";
import type { DeckComposition, Prompt, PromptView } from "./types";

/** SWR key and URL for a finished run's results. */
export function resultsUrl(sessionId: string, runId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/results`;
}

/**
 * What the next run will hold, for the intro after Start session again.
 * Never rejects: a failed load reads as "not known", like the page's own.
 */
export function loadDeckPreview(sessionId: string): Promise<DeckComposition | null> {
  return apiGet(`/api/sessions/${encodeURIComponent(sessionId)}/deck-preview`)
    .then((body: { deck?: DeckComposition | null }) => body.deck ?? null)
    .catch(() => null);
}

/**
 * Map a deck entry to a question view when GET /prompt fails. Keeps the
 * multiple-choice fields so a choice question never turns into a text box.
 * The deck is redacted on the server (no answer key).
 */
export function promptToView(prompt: Prompt, index: number): PromptView {
  const meta: PromptView["meta"] = {};
  if (prompt.meta?.original_prompt_text) meta.original_prompt_text = prompt.meta.original_prompt_text;
  if (prompt.meta?.pack) meta.pack = prompt.meta.pack;
  return {
    prompt_index: index,
    text: prompt.text,
    objective_id: prompt.objective_id,
    difficulty: prompt.difficulty,
    format: prompt.format,
    choices: prompt.choices,
    meta: Object.keys(meta).length > 0 ? meta : undefined,
  };
}
