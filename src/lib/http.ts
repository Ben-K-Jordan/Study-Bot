/**
 * Shared JSON error responses for route handlers.
 *
 * The proxy answers every signed-out API request with UNAUTHORIZED_BODY, so a
 * route that finds no user returns the same body. The client maps errors by
 * status and `code`; one body per status keeps that mapping to one case.
 * The 429 helper is `tooManyRequests` in src/lib/rate-limit.ts.
 */
import { NextResponse } from "next/server";

/** Body of every 401: the proxy's and each route's. */
export const UNAUTHORIZED_BODY = {
  error: "Your sign-in expired. Sign in again.",
  code: "UNAUTHORIZED",
} as const;

/** 401 for a request with no signed-in user. */
export function unauthorized(): NextResponse {
  return NextResponse.json(UNAUTHORIZED_BODY, { status: 401 });
}
