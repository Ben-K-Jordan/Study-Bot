import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import {
  unpublishPlanFromGoogle,
  unpublishRequestSchema,
  calendarErrorMessage,
} from "@/services/publish";
import { logger } from "@/lib/logger";
import { unauthorized } from "@/lib/http";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  // Calls Google Calendar for every session in the plan
  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const { planId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine: all fields optional
  }

  const parsed = unpublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Invalid request",
        code: "validation_failed",
        message: "The calendar options weren't valid.",
        details: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const result = await unpublishPlanFromGoogle(userId, planId, {
      calendarId: parsed.data.calendar_id,
      onlyFuture: parsed.data.only_future,
    });

    if ("error" in result) {
      // `error` keeps the code for API clients; `message` is for the screen
      return NextResponse.json(
        { error: result.error, code: result.error, message: calendarErrorMessage(result.error) },
        { status: result.status || 500 },
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("api.unpublish_google_failed", { user_id: userId, plan_id: planId, error: String(err) });
    return NextResponse.json(
      {
        error: "Events weren't removed from Google Calendar. Retry in a minute.",
        code: "internal",
        message: "Events weren't removed from Google Calendar. Retry in a minute.",
      },
      { status: 500 },
    );
  }
}
