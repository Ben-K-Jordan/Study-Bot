import { NextRequest, NextResponse } from "next/server";
import { unpublishPlanFromGoogle } from "@/services/publish";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = request.headers.get("X-User-Id");
  if (!userId) {
    return NextResponse.json({ error: "Missing X-User-Id header" }, { status: 401 });
  }

  const { planId } = await params;

  try {
    const result = await unpublishPlanFromGoogle(userId, planId);

    if ("error" in result) {
      const status = result.error === "not_found" ? 404
        : result.error === "forbidden" ? 403
        : result.error === "google_not_connected" ? 400
        : 500;
      return NextResponse.json({ error: result.error }, { status });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("api.unpublish_google_failed", { user_id: userId, plan_id: planId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
