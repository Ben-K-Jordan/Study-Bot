import { ApiError, apiRequest, sharedFailureReason } from "@/lib/client-api"

export { SIGNED_OUT_MESSAGE } from "@/lib/client-api"

/**
 * JSON writes Settings sends (PUT, and DELETE with a body), through the
 * shared request helper: ApiError on a non-2xx, Retry-After kept on a 429.
 */
export function sendJson<T>(method: "PUT" | "POST" | "DELETE", url: string, body?: unknown): Promise<T> {
  return apiRequest(method, url, body) as Promise<T>
}

/** Seconds from a raw Retry-After header value ("30"), for fetches that read the response themselves. */
export function retryAfterSeconds(header: string | null | undefined): number | null {
  const raw = header ? Number(header) : NaN
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null
}

/**
 * The sentence for a failed write, by cause: an expired sign-in or too many
 * requests read the same on every screen (sharedFailureReason); anything
 * else gets `fallback`, which names what didn't happen and the fix, such as
 * "Settings not saved. Check your connection and retry."
 */
export function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ApiError ? sharedFailureReason(error) : null) ?? fallback
}

const ACCOUNT_NOT_DELETED = "Account not deleted. Check your connection and retry."

/**
 * Where a failed account deletion is reported: a wrong password goes beside
 * the password field (`field`); anything else is a general failure (`general`).
 */
export function deleteAccountFailure(error: unknown): { field: string | null; general: string | null } {
  if (error instanceof ApiError && error.status === 403 && error.code === "WRONG_PASSWORD") {
    return { field: error.message, general: null }
  }
  return { field: null, general: failureMessage(error, ACCOUNT_NOT_DELETED) }
}
