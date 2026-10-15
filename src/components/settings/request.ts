import { ApiError } from "@/lib/client-api"
import { plural } from "@/lib/format"

/**
 * JSON writes the shared client-api helpers don't cover (PUT, and DELETE
 * with a body). Rejects with ApiError on a non-2xx, like apiPost.
 */
export async function sendJson<T>(
  method: "PUT" | "POST" | "DELETE",
  url: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
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
  return data as T
}

export const SIGNED_OUT_MESSAGE = "Your sign-in expired. Sign in again."

/** Seconds to wait before retrying a 429, from the body or a header value. */
export function retryAfterSeconds(error: unknown, header?: string | null): number | null {
  const fromBody =
    error instanceof ApiError
      ? (error.body as { retry_after_seconds?: unknown } | null)?.retry_after_seconds
      : undefined
  const raw = typeof fromBody === "number" ? fromBody : header ? Number(header) : NaN
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null
}

/**
 * The sentence for a failed write, by cause: an expired sign-in, too many
 * requests, or anything else (`fallback`, which names what didn't happen
 * and the fix, such as "Settings not saved. Check your connection and retry.").
 */
export function failureMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return SIGNED_OUT_MESSAGE
    if (error.status === 429) {
      const seconds = retryAfterSeconds(error)
      return seconds
        ? `Too many requests. Retry in ${plural(seconds, { one: "# second", other: "# seconds" })}.`
        : "Too many requests. Retry in a minute."
    }
  }
  return fallback
}
