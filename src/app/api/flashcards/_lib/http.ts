import { NextResponse } from "next/server";
import type { z } from "zod";
import { plural } from "@/lib/format";
import type { GatewayError } from "@/lib/ai/gateway";

/**
 * Responses shared by the flashcard, chat and assistant routes. Every
 * `error` string is written for the student (it may reach the screen), and
 * `code` lets the client pick its own copy.
 */

export function unauthorized() {
  return NextResponse.json(
    { error: "Your sign-in expired. Sign in again.", code: "UNAUTHORIZED" },
    { status: 401 },
  );
}

export function rateLimited(retryAfterMs: number) {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    {
      error: `Too many requests. Retry in ${plural(seconds, { one: "# second", other: "# seconds" })}.`,
      code: "RATE_LIMITED",
      retry_after: seconds,
    },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

export function invalidJson() {
  return NextResponse.json(
    { error: "The request couldn't be read. Reload the page and retry.", code: "INVALID_JSON" },
    { status: 400 },
  );
}

/** 400 with the zod issues, so the client can point at the field. */
export function invalidInput(error: z.ZodError, message = "Check the highlighted fields.") {
  return NextResponse.json(
    { error: message, code: "INVALID_INPUT", issues: error.issues },
    { status: 400 },
  );
}

export function failed(
  message: string,
  status = 500,
  code = "SERVER_ERROR",
  extra?: Record<string, unknown>,
) {
  return NextResponse.json({ ...extra, error: message, code }, { status });
}

export const AI_PAUSED_MESSAGE = "AI features are paused. Existing decks and guides still work.";

/**
 * Maps an AI gateway failure: AI switched off or over budget reads as
 * paused; anything else is the caller's "not generated" sentence.
 */
export function gatewayFailure(err: GatewayError, notDone: string, extra?: Record<string, unknown>) {
  if (err.code === "AI_DISABLED" || err.code === "BUDGET_EXCEEDED") {
    return NextResponse.json(
      { ...extra, error: AI_PAUSED_MESSAGE, code: err.code },
      { status: err.code === "BUDGET_EXCEEDED" ? 429 : 503 },
    );
  }
  return NextResponse.json({ ...extra, error: notDone, code: err.code }, { status: 502 });
}
