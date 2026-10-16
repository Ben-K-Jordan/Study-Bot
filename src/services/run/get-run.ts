/**
 * The full run for GET /api/runs/{id}: attempts, error logs and the redacted deck.
 */
import { prisma } from "@/lib/db";
import type { Prompt } from "@/lib/prompts";
import { redactPrompts } from "./prompt-view";

// ---- Get Run ----

export async function getRun(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    include: {
      attempts: { orderBy: { promptIndex: "asc" } },
      errorLogs: { orderBy: { promptIndex: "asc" } },
      session: true,
    },
  });

  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  return {
    data: {
      run_id: run.runId,
      session_id: run.sessionId,
      status: run.status,
      mode: run.mode,
      phase: run.phase,
      current_index: run.currentIndex,
      prompt_count: run.promptCount,
      answered_count: run.answeredCount,
      scored_count: run.scoredCount,
      prompts: redactPrompts((run.prompts as unknown as Prompt[]) ?? []),
      policies: run.policies,
      metrics: run.metrics,
      break_state: run.breakState,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: run.endedAt?.toISOString() ?? null,
      attempts: run.attempts.map((a) => ({
        id: a.id,
        prompt_index: a.promptIndex,
        prompt_id: a.promptId,
        prompt_text: a.promptText,
        user_answer: a.userAnswer,
        self_score: a.selfScore,
        confidence_rating: a.confidenceRating,
        time_to_answer_seconds: a.timeToAnswerSeconds,
        created_at: a.createdAt.toISOString(),
      })),
      error_logs: run.errorLogs.map((e) => ({
        prompt_index: e.promptIndex,
        error_type: e.errorType,
        correction_rule: e.correctionRule,
        variant_question: e.variantQuestion,
        created_at: e.createdAt.toISOString(),
      })),
      session: {
        course_name: run.session.courseName,
        exam_name: run.session.examName,
        mode: run.session.mode,
        topic_scope: run.session.topicScope,
      },
    },
  };
}
