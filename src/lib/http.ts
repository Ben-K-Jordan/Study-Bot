/**
 * Shared JSON error responses for route handlers.
 *
 * The proxy answers every signed-out API request with UNAUTHORIZED_BODY, so a
 * route that finds no user returns the same body. The client maps errors by
 * status and `code`; one body per status keeps that mapping to one case.
 * The 429 helper is `tooManyRequests` (src/lib/rate-limit.ts, re-exported here).
 */
import { NextResponse } from "next/server";
import type { z } from "zod";

import { SIGNED_OUT_MESSAGE } from "@/lib/messages";

export { tooManyRequests } from "@/lib/rate-limit";

/** Body of every 401: the proxy's and each route's. */
export const UNAUTHORIZED_BODY = {
  error: SIGNED_OUT_MESSAGE,
  code: "UNAUTHORIZED",
} as const;

/** 401 for a request with no signed-in user. */
export function unauthorized(): NextResponse {
  return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 });
}

/** 400 for a body that isn't JSON. */
export function invalidJson(): NextResponse {
  return NextResponse.json(
    { error: "The request couldn't be read. Reload the page and retry.", code: "INVALID_JSON" },
    { status: 400 },
  );
}

/** 400 with the zod issues, so the client can point at the field. */
export function invalidInput(error: z.ZodError, message = "Check the highlighted fields."): NextResponse {
  return NextResponse.json({ error: message, code: "INVALID_INPUT", issues: error.issues }, { status: 400 });
}
