/**
 * Shared client-side API helpers.
 * Must only be imported from "use client" components.
 *
 * Authentication rides on the NextAuth session cookie (sent automatically
 * on same-origin fetches). No identity headers: the old X-User-Id header
 * could silently split data across phantom identities when a session
 * expired in dev.
 */

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

function withTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
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
    throw new ApiError(typeof message === "string" ? message : "Request failed", res.status, data);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return data as any;
}

export async function apiGet(url: string, init?: { signal?: AbortSignal }) {
  const signal = init?.signal ? AbortSignal.any([init.signal, withTimeout()]) : withTimeout();
  const res = await fetch(url, { signal });
  return parse(res);
}

export async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: withTimeout(60_000), // POST operations may take longer (AI generation)
  });
  return parse(res);
}

export async function apiDelete(url: string) {
  const res = await fetch(url, {
    method: "DELETE",
    signal: withTimeout(),
  });
  return parse(res);
}
