import { NextResponse } from "next/server";
import { plural } from "@/lib/format";

/** A 429 with a Retry-After header and a message that says how long to wait. */
export function tooManyRequests(retryAfterMs: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  const wait = plural(seconds, { one: "# second", other: "# seconds" });
  return NextResponse.json(
    { error: `Too many requests. Retry in ${wait}.`, code: "RATE_LIMITED" },
    { status: 429, headers: { "Retry-After": String(seconds) } },
  );
}

export function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Your sign-in expired. Sign in again.", code: "UNAUTHORIZED" },
    { status: 401 },
  );
}
