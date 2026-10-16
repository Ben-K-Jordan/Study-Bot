import { NextResponse } from "next/server";
import { z } from "zod";
import { UNAUTHORIZED_BODY } from "@/lib/http";

/**
 * Error responses for the session and run routes. `error` is a sentence a
 * student can read (VOICE.md); `code` is the stable value clients branch on.
 * Statuses match what the routes returned before.
 */
const ERRORS = {
  // The same body as every other 401 (UNAUTHORIZED_BODY), code included.
  unauthorized: { status: 401, error: UNAUTHORIZED_BODY.error, code: UNAUTHORIZED_BODY.code },
  session_not_found: {
    status: 404,
    error: "Session not found. This link doesn't match a session. It may have been deleted.",
  },
  run_not_found: { status: 404, error: "Session not found. It may have been deleted." },
  forbidden: { status: 403, error: "This session belongs to another account." },
  unsupported_mode: { status: 400, error: "This kind of session can't be practiced yet." },
  not_on_break: { status: 409, error: "The break already ended." },
  run_not_completed: { status: 409, error: "Finish the session to see its results." },
  invalid_json: { status: 400, error: "The request wasn't valid JSON.", code: "INVALID_JSON" },
} as const;

export type SessionErrorCode = keyof typeof ERRORS;

/** The body's `code` is the key unless the entry names a shared one. */
export function sessionError(code: SessionErrorCode, extra?: Record<string, unknown>) {
  const entry: { status: number; error: string; code?: string } = ERRORS[code];
  return NextResponse.json({ error: entry.error, code: entry.code ?? code, ...extra }, { status: entry.status });
}

/** A failure we didn't expect: what didn't happen, then Retry. */
export function internalError(what: string) {
  return NextResponse.json(
    { error: `${what} Retry in a moment.`, code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

/** Session and run IDs: 21-character nanoids, but older rows and tests use other URL-safe strings. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
