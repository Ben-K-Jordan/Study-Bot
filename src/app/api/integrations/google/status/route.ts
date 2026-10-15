import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { readGoogleStatus } from "./status-dto";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
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
