import { ApiError, sharedFailureReason } from "@/lib/client-api"

/**
 * Turns a failed request into the sentence under "Deck not generated." or
 * "Answer not generated.": the fix, never a raw code or stack text. Codes
 * the flashcard, chat and assistant routes send already carry copy written
 * for the student, so their message is used as is.
 */

/** Codes whose server message is written for the student. */
const STUDENT_FACING_CODES = new Set([
  "RATE_LIMITED",
  "AI_DISABLED",
  "BUDGET_EXCEEDED",
  "NO_MATERIALS",
  "MATERIALS_PROCESSING",
  "NO_CARDS",
  "DOC_NOT_FOUND",
  "DOC_NOT_READY",
  "DECK_NOT_FOUND",
  "CARD_NOT_FOUND",
  "QUESTION_NOT_FOUND",
  "CURSOR_NOT_FOUND",
  "INVALID_INPUT",
  "FORBIDDEN",
])

export const AI_PAUSED = "AI features are paused. Existing decks and guides still work."

function isTimeout(err: unknown): boolean {
  return (
    err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError")
  )
}

/** The fix for a failed request, as one or two sentences. */
export function errorDetail(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "AI_DISABLED" || err.code === "BUDGET_EXCEEDED") return AI_PAUSED
    if (err.code && STUDENT_FACING_CODES.has(err.code) && err.message) return err.message
    // An expired sign-in and too many requests (with the real wait) read the same on every screen.
    const shared = sharedFailureReason(err)
    if (shared) return shared
    if (err.status >= 500) return "The server didn't respond. Retry in a minute."
    return "Reload the page and retry."
  }
  if (isTimeout(err)) return "This took too long. Retry."
  return "Check your connection and retry."
}

/** True when retrying the same request can't help (signed out, AI paused, a missing deck). */
export function isPermanent(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false
  return (
    err.status === 401 ||
    err.code === "AI_DISABLED" ||
    err.code === "BUDGET_EXCEEDED" ||
    err.code === "DECK_NOT_FOUND" ||
    err.code === "NO_MATERIALS"
  )
}

/** Field errors from a 400's zod issues, keyed by the first path segment. */
export function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError) || err.status !== 400) return {}
  const issues = (err.body as { issues?: { path?: unknown[]; message?: string }[] } | null)?.issues
  const out: Record<string, string> = {}
  for (const issue of issues ?? []) {
    const key = issue.path?.[0]
    if (typeof key === "string" && issue.message && !out[key]) out[key] = issue.message
  }
  return out
}
