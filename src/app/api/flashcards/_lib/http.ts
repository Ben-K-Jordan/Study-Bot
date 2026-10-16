import { NextResponse } from "next/server";
import { tooManyRequests } from "@/lib/rate-limit";
import type { GatewayError } from "@/lib/ai/gateway";

/**
 * Responses shared by the flashcard, chat and assistant routes. Every
 * `error` string is written for the student (it may reach the screen), and
 * `code` lets the client pick its own copy.
 */

export { invalidInput, invalidJson, unauthorized } from "@/lib/http";

/** The one 429 body (tooManyRequests): RATE_LIMITED, Retry-After, and the wait in words. */
export function rateLimited(retryAfterMs: number) {
  return tooManyRequests(retryAfterMs);
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
