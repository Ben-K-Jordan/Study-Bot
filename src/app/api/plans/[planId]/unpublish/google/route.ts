import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { unpublishPlanFromGoogle, unpublishRequestSchema } from "@/services/publish";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> },
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // Empty body is fine — all fields optional
  }

  const parsed = unpublishRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await unpublishPlanFromGoogle(userId, planId, {
      calendarId: parsed.data.calendar_id,
      onlyFuture: parsed.data.only_future,
    });

    if ("error" in result) {
      const status = result.status || 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("api.unpublish_google_failed", { user_id: userId, plan_id: planId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
