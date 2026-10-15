import { ApiError, apiPost } from "@/lib/client-api"

/**
 * POST to an auth API route and sort the answer into what the form does
 * next: map field issues onto fields, show a rate-limit message, switch to
 * a screen for a known code, or say the request didn't go through.
 * Raw codes and server internals never reach the page.
 */
export type AuthRequestResult<T> =
  | { ok: true; data: T }
  | { ok: false; kind: "fields"; issues: Record<string, string> }
  | { ok: false; kind: "rate-limited"; message: string }
  | { ok: false; kind: "code"; code: string }
  | { ok: false; kind: "failed" }

const DEFAULT_RATE_LIMIT_TEXT = "Too many requests. Retry in a few minutes."

function issuesFrom(body: unknown): Record<string, string> | null {
  const issues = (body as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return null
  const byField: Record<string, string> = {}
  for (const issue of issues) {
    const field = (issue as { field?: unknown })?.field
    const message = (issue as { message?: unknown })?.message
    if (typeof field === "string" && typeof message === "string" && !(field in byField)) {
      byField[field] = message
    }
  }
  return Object.keys(byField).length > 0 ? byField : null
}

export function interpretAuthError(error: unknown): Exclude<AuthRequestResult<never>, { ok: true }> {
  if (!(error instanceof ApiError)) return { ok: false, kind: "failed" }
  if (error.status === 429) {
    // The auth routes word their own 429s ("Too many reset requests. Retry in 12 minutes.").
    const wordedByRoute = error.message.startsWith("Too many") && !error.message.includes("Please")
    return { ok: false, kind: "rate-limited", message: wordedByRoute ? error.message : DEFAULT_RATE_LIMIT_TEXT }
  }
  const issues = issuesFrom(error.body)
  if (error.status === 400 && issues) return { ok: false, kind: "fields", issues }
  if (error.status < 500 && error.code && error.code !== "INVALID_BODY") {
    return { ok: false, kind: "code", code: error.code }
  }
  return { ok: false, kind: "failed" }
}

export async function postAuth<T = unknown>(url: string, body: unknown): Promise<AuthRequestResult<T>> {
  try {
    const data = (await apiPost(url, body)) as T
    return { ok: true, data }
  } catch (error) {
    return interpretAuthError(error)
  }
}
