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

const DEFAULT_TIMEOUT_MS = 30_000;

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return { ...extra };
}

function withTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(timeoutMs);
}

export async function apiGet(url: string) {
  const res = await fetch(url, { headers: authHeaders(), signal: withTimeout() });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function apiPost(url: string, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
    signal: withTimeout(60_000), // POST operations may take longer (AI generation)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

export async function apiDelete(url: string) {
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
    signal: withTimeout(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
