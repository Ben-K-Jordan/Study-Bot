import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import { generateRetrievalPrompts } from "@/lib/prompts";
import { initBreakState, checkBreakNeeded, type BreakState } from "@/lib/breaks";
import { computeFollowups } from "@/lib/spacing";
import type { SubmitAttemptInput } from "@/lib/validation";

// ---- Types ----

interface RunMetrics {
  attempts_count: number;
  correct_count: number;
  partial_count: number;
  incorrect_count: number;
  accuracy: number;
  time_spent_seconds: number;
  recommended_followups?: { label: string; days_from_now: number; date: string }[];
}

function emptyMetrics(): RunMetrics {
  return {
    attempts_count: 0,
    correct_count: 0,
    partial_count: 0,
    incorrect_count: 0,
    accuracy: 0,
    time_spent_seconds: 0,
  };
}

// ---- Start / Resume ----

export async function startOrResumeRun(userId: string, sessionId: string) {
  // Fetch session
  const session = await prisma.session.findUnique({ where: { sessionId } });
  if (!session) return { error: "session_not_found" as const };
  if (session.userId !== userId) return { error: "forbidden" as const };
  if (session.mode !== "RETRIEVAL") {
    return { error: "unsupported_mode" as const };
  }

  // Check for existing active run
  const existingRun = await prisma.sessionRun.findFirst({
    where: { sessionId: session.sessionId, userId, status: { in: ["CREATED", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existingRun) {
    // Resume: update break state in case time passed
    const breakState = existingRun.breakState as unknown as BreakState;
    const updatedBreakState = checkBreakNeeded(breakState);
    if (updatedBreakState !== breakState) {
      await prisma.sessionRun.update({
        where: { id: existingRun.id },
        data: { breakState: updatedBreakState as object },
      });
    }

    return {
      data: {
        run_id: existingRun.runId,
        status: existingRun.status,
        current_index: existingRun.currentIndex,
        prompts: existingRun.prompts,
        metrics: existingRun.metrics,
        break_state: updatedBreakState,
        resumed: true,
      },
    };
  }

  // Create new run
  const targetOutcome = session.targetOutcome as Record<string, unknown> | null;
  const objectives = session.objectives as { id: string; title: string }[] | null;
  const breakProtocol = session.breakProtocol as { type?: string; cycles?: number } | null;

  const prompts = generateRetrievalPrompts({
    objectives,
    target_outcome: targetOutcome
      ? { prompt_count: targetOutcome.prompt_count as number | undefined }
      : null,
    topic_scope: session.topicScope,
  });

  const runId = generateSessionId();
  const breakState = initBreakState(breakProtocol);
  const metrics = emptyMetrics();

  const run = await prisma.sessionRun.create({
    data: {
      runId,
      sessionId: session.sessionId,
      userId,
      status: "ACTIVE",
      startedAt: new Date(),
      currentIndex: 0,
      prompts: prompts as object[],
      metrics: metrics as object,
      breakState: breakState as object,
    },
  });

  return {
    data: {
      run_id: run.runId,
      status: run.status,
      current_index: 0,
      prompts,
      metrics,
      break_state: breakState,
      resumed: false,
    },
  };
}

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
      current_index: run.currentIndex,
      prompts: run.prompts,
      metrics: run.metrics,
      break_state: run.breakState,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: run.endedAt?.toISOString() ?? null,
      attempts: run.attempts.map((a) => ({
        prompt_index: a.promptIndex,
        prompt_id: a.promptId,
        prompt_text: a.promptText,
        user_answer: a.userAnswer,
        self_score: a.selfScore,
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

// ---- Submit Attempt ----

export async function submitAttempt(userId: string, runId: string, input: SubmitAttemptInput) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.status === "COMPLETED") return { error: "run_completed" as const };

  // Check break state
  const breakState = checkBreakNeeded(run.breakState as unknown as BreakState);
  if (breakState.on_break) {
    // Persist updated break state
    await prisma.sessionRun.update({
      where: { id: run.id },
      data: { breakState: breakState as object },
    });
    return { error: "on_break" as const, break_state: breakState };
  }

  // Enforce linear flow
  if (input.prompt_index !== run.currentIndex) {
    return { error: "wrong_index" as const, expected: run.currentIndex };
  }

  const prompts = run.prompts as { id: string; text: string }[];
  const prompt = prompts[input.prompt_index];
  if (!prompt) return { error: "invalid_index" as const };

  // Insert attempt
  await prisma.sessionAttempt.create({
    data: {
      runId: run.runId,
      promptIndex: input.prompt_index,
      promptId: prompt.id,
      promptText: prompt.text,
      userAnswer: input.user_answer,
      selfScore: input.self_score,
      timeToAnswerSeconds: input.time_to_answer_seconds ?? null,
    },
  });

  // Insert error log if needed
  if (
    (input.self_score === "PARTIAL" || input.self_score === "INCORRECT") &&
    input.error_log
  ) {
    await prisma.sessionErrorLog.create({
      data: {
        runId: run.runId,
        promptIndex: input.prompt_index,
        errorType: input.error_log.error_type,
        correctionRule: input.error_log.correction_rule,
        variantQuestion: input.error_log.variant_question ?? null,
      },
    });
  }

  // Update metrics
  const metrics = run.metrics as unknown as RunMetrics;
  const newMetrics: RunMetrics = {
    attempts_count: metrics.attempts_count + 1,
    correct_count: metrics.correct_count + (input.self_score === "CORRECT" ? 1 : 0),
    partial_count: metrics.partial_count + (input.self_score === "PARTIAL" ? 1 : 0),
    incorrect_count: metrics.incorrect_count + (input.self_score === "INCORRECT" ? 1 : 0),
    accuracy: 0,
    time_spent_seconds:
      metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
  };
  newMetrics.accuracy =
    newMetrics.attempts_count > 0
      ? newMetrics.correct_count / newMetrics.attempts_count
      : 0;

  const newIndex = run.currentIndex + 1;
  const isLastPrompt = newIndex >= prompts.length;

  // Check if break is needed after advancing
  const updatedBreakState = isLastPrompt ? breakState : checkBreakNeeded(breakState);

  await prisma.sessionRun.update({
    where: { id: run.id },
    data: {
      currentIndex: newIndex,
      metrics: newMetrics as object,
      breakState: updatedBreakState as object,
      status: isLastPrompt ? "COMPLETED" : "ACTIVE",
      endedAt: isLastPrompt ? new Date() : undefined,
    },
  });

  // If completed, add followup recommendations
  if (isLastPrompt) {
    const followups = computeFollowups(newMetrics.accuracy);
    const finalMetrics = { ...newMetrics, recommended_followups: followups };
    await prisma.sessionRun.update({
      where: { id: run.id },
      data: { metrics: finalMetrics as object },
    });

    return {
      data: {
        status: "COMPLETED" as const,
        current_index: newIndex,
        metrics: finalMetrics,
        break_state: updatedBreakState,
      },
    };
  }

  return {
    data: {
      status: "ACTIVE" as const,
      current_index: newIndex,
      metrics: newMetrics,
      break_state: updatedBreakState,
    },
  };
}

// ---- Complete Run (manual) ----

export async function completeRun(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.status === "COMPLETED") return { error: "already_completed" as const };

  const metrics = run.metrics as unknown as RunMetrics;
  const followups = computeFollowups(metrics.accuracy);
  const finalMetrics = { ...metrics, recommended_followups: followups };

  await prisma.sessionRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
      metrics: finalMetrics as object,
    },
  });

  return {
    data: {
      run_id: run.runId,
      status: "COMPLETED" as const,
      metrics: finalMetrics,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: new Date().toISOString(),
    },
  };
}

// ---- End break early ----

export async function endBreak(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const breakState = run.breakState as unknown as BreakState;
  if (!breakState.on_break) return { error: "not_on_break" as const };

  const now = new Date();
  const newState: BreakState = {
    ...breakState,
    on_break: false,
    break_started_at: undefined,
    current_cycle: breakState.current_cycle + 1,
    work_started_at: now.toISOString(),
    completed_breaks: [...breakState.completed_breaks, breakState.break_started_at!],
  };

  await prisma.sessionRun.update({
    where: { id: run.id },
    data: { breakState: newState as object },
  });

  return { data: { break_state: newState } };
}
