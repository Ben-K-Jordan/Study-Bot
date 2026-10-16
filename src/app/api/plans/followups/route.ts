import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { scheduleFollowups } from "@/services/followups";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { z } from "zod";
import { unauthorized } from "@/lib/http";

const bodySchema = z.object({ run_id: z.string().min(1).max(100) });

/** Sentences for the service's error codes; the code travels as `code`. */
const FOLLOWUP_ERRORS: Record<string, { status: number; message: string }> = {
  not_found: { status: 404, message: "This session's results weren't found." },
  forbidden: { status: 403, message: "This session belongs to another account." },
  run_not_completed: { status: 409, message: "Finish the session before adding follow-ups." },
};

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request wasn't valid JSON.", code: "INVALID_JSON" },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Follow-ups need a finished session.", code: "validation_failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await scheduleFollowups(userId, parsed.data.run_id);

    if ("error" in result && result.error) {
      const known = FOLLOWUP_ERRORS[result.error] ?? {
        status: 409,
        message: "Follow-ups weren't added. Retry in a minute.",
      };
      return NextResponse.json(
        { error: known.message, code: result.error },
        { status: known.status },
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("followups_schedule_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Follow-ups weren't added. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}
