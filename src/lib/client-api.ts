/**
 * Shared client-side API helpers.
 * Must only be imported from "use client" components.
 *
 * Authentication rides on the NextAuth session cookie (sent automatically
 * on same-origin fetches). No identity headers: the old X-User-Id header
 * could silently split data across phantom identities when a session
 * expired in dev.
 */

import { anySignal } from "@/lib/abort";
import { retryAfterText } from "@/lib/format";
import { SIGNED_OUT_MESSAGE } from "@/lib/messages";

export interface CourseOption {
  course_name: string;
  exam_name?: string;
  doc_count: number;
}

/**
 * A failed API call. `message` keeps the server's error text so existing
 * callers behave as before; `status` and `code` let screens choose their own
 * copy (sign-in expired, too many requests, not found).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
    const code = (body as { code?: unknown } | null)?.code;
    this.code = typeof code === "string" ? code : undefined;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** POST operations may take longer (AI generation). */
const POST_TIMEOUT_MS = 60_000;

function withTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

/** Seconds from a Retry-After header in its delay form ("30"); null otherwise. */
function retryAfterHeader(res: Response): number | null {
  const raw = Number(res.headers.get("Retry-After"));
  return Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null;
}

async function parse(res: Response) {
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error;
    // Keep Retry-After with the error, so the message can say how long to
    // wait (a body value from the server wins).
    const wait = res.status === 429 ? retryAfterHeader(res) : null;
    const body =
      wait && (data === null || (typeof data === "object" && !Array.isArray(data)))
        ? { retry_after_seconds: wait, ...(data as object | null) }
        : data;
    throw new ApiError(typeof message === "string" ? message : "Request failed", res.status, body);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ApiRequestOptions {
  /** Cancels the request (for example when the course changes). */
  signal?: AbortSignal;
  /** Defaults to 60 seconds for POST and 30 seconds for everything else. */
  timeoutMs?: number;
}

/**
 * One JSON request to the app's API. Sends `body` as JSON when given, parses
 * the JSON answer, and rejects with ApiError on a non-2xx (with
 * `retry_after_seconds` in its body on a 429 that sent Retry-After), with a
 * DOMException named TimeoutError when the time runs out, and with a
 * TypeError when there is no connection. The helpers below are this with a
 * fixed method; use it directly for PUT or a DELETE with a body.
 */
export async function apiRequest(method: ApiMethod, url: string, body?: unknown, options: ApiRequestOptions = {}) {
  const timeout = withTimeout(options.timeoutMs ?? (method === "POST" ? POST_TIMEOUT_MS : DEFAULT_TIMEOUT_MS));
  const signal = options.signal ? anySignal(options.signal, timeout) : timeout;
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  return parse(res);
}

export async function apiGet(url: string, init?: { signal?: AbortSignal }) {
  return apiRequest("GET", url, undefined, init);
}

export async function apiPost(url: string, body: unknown, options?: ApiRequestOptions) {
  return apiRequest("POST", url, body, options);
}

export async function apiPatch(url: string, body: unknown, options?: ApiRequestOptions) {
  return apiRequest("PATCH", url, body, options);
}

export async function apiDelete(url: string, options?: ApiRequestOptions) {
  return apiRequest("DELETE", url, undefined, options);
}

/* --------------------------------------------------------------------------
   Failure copy every screen shares. A screen words its own codes (a missing
   deck, a plan that belongs to another account) and asks these first for the
   causes that read the same everywhere.
   -------------------------------------------------------------------------- */

export { SIGNED_OUT_MESSAGE };

/** Seconds to wait before retrying a 429: from the server's body, else its Retry-After header. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof ApiError)) return null;
  const raw = (error.body as { retry_after_seconds?: unknown } | null)?.retry_after_seconds;
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.ceil(raw) : null;
}

/**
 * The sentence for a failure that reads the same on every screen: an expired
 * sign-in, too many requests (with the real wait), a timeout, or no
 * connection. Null for anything else, which the screen words itself.
 */
export function sharedFailureReason(error: unknown): string | null {
  if (error instanceof ApiError) {
    if (error.status === 401) return SIGNED_OUT_MESSAGE;
    // The proxy's own sentence: the request came from another site.
    if (error.status === 403 && error.code === "CROSS_SITE_REQUEST") return error.message;
    if (error.status === 429) {
      const seconds = retryAfterSeconds(error);
      if (seconds) return `Too many requests. ${retryAfterText(seconds)}`;
      // A server sentence (it has spaces; a raw code doesn't) already says how long to wait.
      const sent = (error.body as { error?: unknown } | null)?.error;
      return typeof sent === "string" && /\s/.test(sent.trim()) ? sent : "Too many requests. Retry in a minute.";
    }
    return null;
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The server took too long to answer. Retry.";
  }
  // fetch rejects with a TypeError when the request never reached the server
  if (error instanceof TypeError) return "Check your connection and retry.";
  return null;
}

/** `sharedFailureReason`, else `fallback` ("Settings not saved. Check your connection and retry."). */
export function failureMessage(error: unknown, fallback: string): string {
  return sharedFailureReason(error) ?? fallback;
}
