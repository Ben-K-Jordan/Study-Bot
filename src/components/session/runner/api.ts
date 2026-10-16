/**
 * The runner's own network calls. Attempts go through the session screen's
 * onSubmit; these cover the model answer, the next question when it didn't
 * arrive, and reflections saved after feedback.
 */
import { ApiError, apiGet, apiPatch, apiPost } from "@/lib/client-api"

import type { RevealPayload, RunnerPrompt } from "./types"

/** Commits the typed answer and returns the model answer to score against. */
export function revealForAnswer(runId: string, index: number, answer: string): Promise<RevealPayload> {
  return apiPost(`/api/runs/${encodeURIComponent(runId)}/reveal`, { index, user_answer: answer })
}

export function revealUrl(runId: string, index: number): string {
  return `/api/runs/${encodeURIComponent(runId)}/reveal?index=${index}`
}

/**
 * GET /prompt for one question. In exam scoring (phase REVIEW) the server
 * adds the multiple-choice key, so that phase gets its own URL, and with it
 * its own SWR cache entry: a copy loaded while answering, without the key,
 * is never served to the scoring screen. The route ignores the parameter.
 * Other phases keep the plain URL, which the session screen's preload
 * shares, so an adaptive GET is never sent twice.
 */
export function promptUrl(runId: string, index: number, phase?: string): string {
  const base = `/api/runs/${encodeURIComponent(runId)}/prompt?index=${index}`
  return phase === "REVIEW" ? `${base}&phase=review` : base
}

export function runUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}`
}

export function feedbackUrl(attemptId: string): string {
  return `/api/attempts/${encodeURIComponent(attemptId)}/feedback`
}

export function fetchPrompt(runId: string, index: number, phase?: string): Promise<RunnerPrompt> {
  return apiGet(promptUrl(runId, index, phase))
}

/** Saves the reflection typed after feedback against the attempt it belongs to. */
export async function saveReflection(
  attemptId: string,
  reflection: { self_explanation?: string; generated_example?: string; socratic_answer?: string }
): Promise<void> {
  await apiPatch(`/api/attempts/${encodeURIComponent(attemptId)}/meta`, reflection)
}

/**
 * True when retrying the same request can't help and only a reload can:
 * a 409 (another tab answered, the answer was already saved before a
 * timeout, the session finished) or a message that already says to reload.
 * The draft in localStorage brings the typed answer back after the reload.
 */
export function needsReload(error: unknown): boolean {
  if (error instanceof ApiError && error.status === 409) return true
  const message = error instanceof Error ? error.message : ""
  return /\bReload\b/.test(message)
}

/**
 * Readable text for a failed save. Server messages that tell the student to
 * reload (another tab answered, the session finished) are shown as they
 * are; anything else gets the fallback, never a raw code.
 */
export function failureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : ""
  const status = error instanceof ApiError ? error.status : undefined
  if (status === 401) return "Your sign-in expired. Sign in again, then come back to this session."
  if (/Reload to (continue|see your results)\.$/.test(message)) return message
  if (status === 429) return "Too many requests. Wait a moment, then retry."
  return fallback
}
