import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { updateAttemptMeta } from "@/services/run";
import { updateAttemptMetaSchema } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { z } from "zod/v4";

/**
 * PATCH /api/attempts/:attemptId/meta
 *
 * Attach post-review metacognition (self-explanation / generated example)
 * to an already-submitted attempt. The review panel collects these AFTER
 * the attempt exists — they must never be posted as a new attempt.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { attemptId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { attemptId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = updateAttemptMetaSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const result = await updateAttemptMeta(userId, attemptId, parsed);

    if ("error" in result) {
      if (result.error === "not_found") {
        return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
      }
      if (result.error === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    return NextResponse.json(result.data);
  } catch (err) {
    logger.error("attempt_meta_update_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
