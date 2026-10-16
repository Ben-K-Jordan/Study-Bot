import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readGoogleStatus } from "@/services/google-status";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  try {
    return NextResponse.json(await readGoogleStatus(userId));
  } catch (err) {
    logger.error("google.status_failed", { user_id: userId, error: String(err) });
    return NextResponse.json(
      { error: "Google Calendar status didn't load. Retry." },
      { status: 500 },
    );
  }
}
