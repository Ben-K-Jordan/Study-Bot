"use client";

import { apiGet } from "@/lib/client-api";
import type { Prompt, PromptView } from "./types";

/** SWR key and URL for a finished run's results. */
export function resultsUrl(sessionId: string, runId: string): string {
  return `/api/sessions/${encodeURIComponent(sessionId)}/runs/${encodeURIComponent(runId)}/results`;
}

/** One question of a run by index. */
export function fetchPrompt(runId: string, index: number): Promise<PromptView> {
  return apiGet(`/api/runs/${encodeURIComponent(runId)}/prompt?index=${index}`);
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
