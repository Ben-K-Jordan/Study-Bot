import { NextResponse } from "next/server";
import { z } from "zod";

/**
 * Error responses for the session and run routes. `error` is a sentence a
 * student can read (VOICE.md); `code` is the stable value clients branch on.
 * Statuses match what the routes returned before.
 */
const ERRORS = {
  unauthorized: { status: 401, error: "Your sign-in expired. Sign in again." },
  session_not_found: {
    status: 404,
    error: "Session not found. This link doesn't match a session. It may have been deleted.",
  },
  run_not_found: { status: 404, error: "Session not found. It may have been deleted." },
  forbidden: { status: 403, error: "This session belongs to another account." },
  unsupported_mode: { status: 400, error: "This kind of session can't be practiced yet." },
  not_on_break: { status: 409, error: "The break already ended." },
  run_not_completed: { status: 409, error: "Finish the session to see its results." },
  invalid_json: { status: 400, error: "The request wasn't valid JSON." },
} as const;

export type SessionErrorCode = keyof typeof ERRORS;

export function sessionError(code: SessionErrorCode, extra?: Record<string, unknown>) {
  const { status, error } = ERRORS[code];
  return NextResponse.json({ error, code, ...extra }, { status });
}

/** A failure we didn't expect: what didn't happen, then Retry. */
export function internalError(what: string) {
  return NextResponse.json(
    { error: `${what} Retry in a moment.`, code: "internal_error" },
    { status: 500 },
  );
}

/** Session and run IDs: 21-character nanoids, but older rows and tests use other URL-safe strings. */
export const idSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
