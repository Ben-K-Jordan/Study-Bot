import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { submitAttempt } from "@/services/run";
import { parseAttemptPayload } from "@/lib/validation";
import { logger } from "@/lib/logger";
import { z } from "zod/v4";

export async function POST(
  request: NextRequest,
  { params }: { params: { runId: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { runId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = parseAttemptPayload(body);
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
    const result = await submitAttempt(userId, runId, parsed);

    if ("error" in result) {
      const err = result.error;
      if (err === "not_found") {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      if (err === "forbidden") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (err === "run_completed") {
        return NextResponse.json({ error: "Run is already completed" }, { status: 409 });
      }
      if (err === "on_break") {
        return NextResponse.json(
          { error: "Cannot submit during break", break_state: (result as any).break_state },
          { status: 409 }
        );
      }
      if (err === "wrong_index") {
        return NextResponse.json(
          { error: "Wrong prompt index", expected: (result as any).expected },
          { status: 409 }
        );
      }
      if (err === "invalid_index") {
        return NextResponse.json({ error: "Invalid prompt index" }, { status: 400 });
      }
      if (err === "duplicate_attempt") {
        return NextResponse.json({ error: "Attempt already submitted for this prompt" }, { status: 409 });
      }
      if (err === "wrong_phase") {
        return NextResponse.json(
          { error: (result as any).message || "Invalid operation for current phase" },
          { status: 409 }
        );
      }
      if (err === "no_attempt_to_score") {
        return NextResponse.json({ error: "No attempt found to score at this index" }, { status: 409 });
      }
      if (err === "already_scored") {
        return NextResponse.json({ error: "This attempt has already been scored" }, { status: 409 });
      }
      if (err === "missing_score") {
        return NextResponse.json({ error: "self_score is required for SCORE kind" }, { status: 400 });
      }
    }

    const payload = JSON.stringify(result.data);
    logger.info("attempt.response", {
      run_id: runId,
      payload_bytes: payload.length,
    });
    return new NextResponse(payload, {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Failed to submit attempt:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
