import { ApiError } from "@/lib/client-api"

/**
 * A failed request as the sentence that follows "{Object} not {verb}."
 * Study Bot's own routes send a VOICE.md sentence with a `code`; anything
 * else (a proxy error page, a dropped connection, a timeout) gets a sentence
 * chosen by status.
 */
export function describeRequestError(
  error: unknown,
  fallback = "Check your connection and retry."
): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "Your sign-in expired. Sign in again."
    if (error.code && error.message) return error.message
    if (error.status === 429) return "Too many requests. Retry in 30 seconds."
    return fallback
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The server took too long to answer. Retry."
  }
  return fallback
}
