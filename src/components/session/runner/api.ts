/**
 * The runner's own network calls. Attempts go through the session screen's
 * onSubmit; these cover the model answer, the next question when it didn't
 * arrive, and reflections saved after feedback.
 */
import { ApiError, apiGet, apiPost } from "@/lib/client-api"

import type { RevealPayload, RunnerPrompt } from "./types"

/** Commits the typed answer and returns the model answer to score against. */
export function revealForAnswer(runId: string, index: number, answer: string): Promise<RevealPayload> {
  return apiPost(`/api/runs/${encodeURIComponent(runId)}/reveal`, { index, user_answer: answer })
}

export function revealUrl(runId: string, index: number): string {
  return `/api/runs/${encodeURIComponent(runId)}/reveal?index=${index}`
}

export function promptUrl(runId: string, index: number): string {
  return `/api/runs/${encodeURIComponent(runId)}/prompt?index=${index}`
}

export function runUrl(runId: string): string {
  return `/api/runs/${encodeURIComponent(runId)}`
}

export function feedbackUrl(attemptId: string): string {
  return `/api/attempts/${encodeURIComponent(attemptId)}/feedback`
}

export function fetchPrompt(runId: string, index: number): Promise<RunnerPrompt> {
  return apiGet(promptUrl(runId, index))
}

/** Saves the reflection typed after feedback against the attempt it belongs to. */
export async function saveReflection(
  attemptId: string,
  reflection: { self_explanation?: string; generated_example?: string; socratic_answer?: string }
): Promise<void> {
  const res = await fetch(`/api/attempts/${encodeURIComponent(attemptId)}/meta`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reflection),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null)
    const message = (body as { error?: unknown } | null)?.error
    throw new ApiError(typeof message === "string" ? message : "Reflection not saved.", res.status, body)
  }
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
