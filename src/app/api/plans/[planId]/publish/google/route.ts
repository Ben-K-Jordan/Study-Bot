import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import {
  publishPlanToGoogle,
  getPublishStatus,
  publishRequestSchema,
  calendarErrorMessage,
} from "@/services/publish";
import { logger } from "@/lib/logger";

/**
 * Errors keep the machine code in `error` (API clients and tests match on
 * it) and repeat it as `code`; `message` is the sentence to show.
 */
function errorResponse(code: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { error: code, code, message: calendarErrorMessage(code), ...extra },
    { status },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", code: "unauthorized", message: "Your sign-in expired. Sign in again." },
      { status: 401 },
    );
  }

  const { planId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine: all fields optional
  }

  const parsed = publishRequestSchema.safeParse(body);
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
    const result = await publishPlanToGoogle(userId, planId, {
      calendarId: parsed.data.calendar_id,
      force: parsed.data.force,
      dryRun: parsed.data.dry_run,
    });

    if ("error" in result) {
      return errorResponse(
        result.error,
        result.status || 500,
        result.current_calendar_id ? { current_calendar_id: result.current_calendar_id } : {},
      );
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("api.publish_google_failed", { user_id: userId, plan_id: planId, error: String(err) });
    return NextResponse.json(
      {
        error: "Sessions weren't added to Google Calendar. Retry in a minute.",
        code: "internal",
        message: "Sessions weren't added to Google Calendar. Retry in a minute.",
      },
      { status: 500 },
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Unauthorized", code: "unauthorized", message: "Your sign-in expired. Sign in again." },
      { status: 401 },
    );
  }

  const { planId } = await params;

  try {
    const result = await getPublishStatus(userId, planId);

    if ("error" in result) {
      return errorResponse(result.error, result.status || 500);
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("api.publish_status_failed", { user_id: userId, plan_id: planId, error: String(err) });
    return NextResponse.json(
      {
        error: "The Google Calendar status didn't load. Retry in a minute.",
        code: "internal",
        message: "The Google Calendar status didn't load. Retry in a minute.",
      },
      { status: 500 },
    );
  }
}
