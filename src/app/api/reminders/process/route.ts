import { NextRequest, NextResponse } from "next/server";
import { processScheduledReminders } from "@/lib/email/scheduler";
import { logger } from "@/lib/logger";

// POST /api/reminders/process — process all due scheduled reminders
// This endpoint is intended to be called by a cron job or background worker.
// It requires either:
//   - An Authorization header matching the CRON_SECRET env var
//   - An admin user session (x-user-id of an admin, for dev/testing)

function isAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;

  // Check Authorization: Bearer <secret> header
  const authHeader = request.headers.get("authorization");
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  // In non-production, allow if no CRON_SECRET is configured
  if (!cronSecret && process.env.NODE_ENV !== "production") {
    logger.warn("reminders_process_no_secret", {
      message: "CRON_SECRET not set — allowing unauthenticated access in dev",
    });
    return true;
  }

  return false;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await processScheduledReminders();

    logger.info("process_reminders_api", {
      processed: result.processed,
      failed: result.failed,
    });

    return NextResponse.json({
      message: "Reminders processed",
      processed: result.processed,
      failed: result.failed,
    });
  } catch (err) {
    logger.error("process_reminders_api_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
