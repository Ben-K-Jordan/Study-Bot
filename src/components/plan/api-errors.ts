import { ApiError } from "@/lib/client-api"

/** Codes and placeholder strings that must never reach the screen. */
const RAW = /^[A-Z0-9_]+$|^[a-z0-9_]+$|^(Request failed|Internal server error|Validation failed|Unauthorized|Forbidden)$/

function bodyField(body: unknown, field: "message" | "error"): string | undefined {
  const value = (body as Record<string, unknown> | null)?.[field]
  return typeof value === "string" && value.trim() && !RAW.test(value.trim()) ? value : undefined
}

/** The machine code of a failed call, from `code` or a code-shaped `error`. */
export function errorCode(error: unknown): string | undefined {
  if (!(error instanceof ApiError)) return undefined
  if (error.code) return error.code
  const raw = (error.body as { error?: unknown } | null)?.error
  return typeof raw === "string" && RAW.test(raw) ? raw : undefined
}

/**
 * A sentence for a failed request: the server's own sentence when it sent
 * one, else one chosen by status, else `fallback` ("Plan not deleted.").
 * Raw codes and placeholder strings never pass through.
 */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your sign-in expired. Sign in again."
    const own = bodyField(error.body, "message") ?? bodyField(error.body, "error")
    if (own) return own
    if (error.status === 429) return "Too many requests. Retry in a minute."
    if (error.status === 403) return "This belongs to another account."
    if (error.status >= 500) return `${fallback} Retry in a minute.`
    return fallback
  }
  if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return `${fallback} The server took too long. Retry.`
  }
  return `${fallback} Check your connection and retry.`
}

/** Field errors from a 400's `issues`, keyed by the first path segment. */
export function fieldIssues(error: unknown): Record<string, string> {
  if (!(error instanceof ApiError)) return {}
  const issues = (error.body as { issues?: unknown } | null)?.issues
  if (!Array.isArray(issues)) return {}
  const out: Record<string, string> = {}
  for (const issue of issues) {
    const path = (issue as { path?: unknown }).path
    const message = (issue as { message?: unknown }).message
    const key = Array.isArray(path) && path.length > 0 ? String(path[0]) : ""
    if (key && typeof message === "string" && !out[key]) out[key] = message
  }
  return out
}

/** Parse a fetch Response the way client-api does, for calls it can't make (uploads, blobs). */
export async function readJson(res: Response): Promise<unknown> {
  const text = await res.text()
  let data: unknown = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error
    throw new ApiError(typeof message === "string" ? message : "Request failed", res.status, data)
  }
  return data
}
