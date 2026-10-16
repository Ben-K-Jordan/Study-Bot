import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { getAnswerReveal } from "@/services/run";
import { logger } from "@/lib/logger";

/**
 * The model answer and points to check for the run's current question.
 *
 * POST /api/runs/:runId/reveal  { index, user_answer }
 *   Free recall: commits the student's answer and returns the standard to
 *   score it against. The first committed answer is the one recorded with
 *   the score.
 * GET /api/runs/:runId/reveal?index=N
 *   Only for a question that already has a recorded attempt (exam
 *   simulation scoring, an answered multiple-choice question). An
 *   unanswered free-recall question gets 409 and no model answer, so a
 *   prefetch can never show the answer before the student commits one.
 *
 * Never during the EXAM phase of an exam simulation.
 */

const MESSAGES = {
  badIndex: "This question isn't in the session. Reload to continue.",
  badAnswer: "Write an answer before you check it.",
  notFound: "Session not found. It may have been deleted.",
  forbidden: "This session belongs to another account.",
  wrongIndex: "This question was answered in another tab. Reload to continue.",
  answerRequired: "Answer the question before you see the model answer.",
  failed: "The model answer didn't load. Retry.",
} as const;

const revealBodySchema = z.object({
  index: z.number().int().min(0),
  user_answer: z.string().trim().min(1).max(20_000),
});

type RevealResult = Awaited<ReturnType<typeof getAnswerReveal>>;

function toResponse(result: RevealResult): NextResponse {
  if ("error" in result) {
    switch (result.error) {
      case "not_found":
        return NextResponse.json({ error: MESSAGES.notFound }, { status: 404 });
      case "forbidden":
        return NextResponse.json({ error: MESSAGES.forbidden }, { status: 403 });
      case "wrong_phase":
        return NextResponse.json({ error: result.message, code: "wrong_phase" }, { status: 409 });
      case "wrong_index":
        return NextResponse.json(
          { error: MESSAGES.wrongIndex, code: "wrong_index", expected: result.expected },
          { status: 409 }
        );
      case "answer_required":
        return NextResponse.json({ error: MESSAGES.answerRequired, code: "answer_required" }, { status: 409 });
    }
  }
  return NextResponse.json(result.data);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const { runId } = await params;
  const indexStr = new URL(request.url).searchParams.get("index");
  const index = indexStr === null ? NaN : Number(indexStr);
  if (!Number.isInteger(index) || index < 0) {
    return NextResponse.json({ error: MESSAGES.badIndex }, { status: 400 });
  }

  try {
    return toResponse(await getAnswerReveal(userId, runId, index));
  } catch (err) {
    logger.error("run_reveal_failed", { error: String(err) });
    return NextResponse.json({ error: MESSAGES.failed }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const { runId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: MESSAGES.badAnswer }, { status: 400 });
  }

  const parsed = revealBodySchema.safeParse(body);
  if (!parsed.success) {
    const indexIssue = parsed.error.issues.some((issue) => issue.path[0] === "index");
    return NextResponse.json(
      { error: indexIssue ? MESSAGES.badIndex : MESSAGES.badAnswer, issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    return toResponse(
      await getAnswerReveal(userId, runId, parsed.data.index, { userAnswer: parsed.data.user_answer })
    );
  } catch (err) {
    logger.error("run_reveal_failed", { error: String(err) });
    return NextResponse.json({ error: MESSAGES.failed }, { status: 500 });
  }
}
