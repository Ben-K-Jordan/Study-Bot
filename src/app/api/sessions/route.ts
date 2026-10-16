import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { createSession } from "@/services/session";
import { z } from "zod";
import { logger } from "@/lib/logger";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";
import { internalError, sessionError } from "./session-errors";

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return sessionError("unauthorized");

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return sessionError("invalid_json");
  }

  try {
    const result = await createSession(userId, body);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Check the highlighted fields.", code: "validation_failed", issues: err.issues },
        { status: 400 }
      );
    }
    logger.error("create_session_failed", { error: String(err) });
    return internalError("Session not created.");
  }
}
