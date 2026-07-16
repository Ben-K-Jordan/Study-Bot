import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { scheduleFollowups } from "@/services/followups";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { z } from "zod/v4";

const bodySchema = z.object({ run_id: z.string().min(1) });

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    const result = await scheduleFollowups(userId, parsed.data.run_id);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.json({ error: result.error }, { status: 409 });
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("followups_schedule_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
