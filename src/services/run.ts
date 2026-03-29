import { prisma } from "@/lib/db";
import { generateSessionId } from "@/lib/session-id";
import {
  generateRetrievalPrompts,
  generateInterleavedPrompts,
  generateExamSimPrompts,
  generateErrorRepairPrompts,
  type Prompt,
  type ErrorLogForRepair,
} from "@/lib/prompts";
import { initBreakState, checkBreakNeeded, type BreakState } from "@/lib/breaks";
import { computeFollowups } from "@/lib/spacing";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import type {
  SubmitAttemptInput,
  ExamAnswerInput,
  ExamScoreInput,
  AttemptPayload,
  RunnableMode,
} from "@/lib/validation";
import { RUNNABLE_MODES } from "@/lib/validation";

// ---- Types ----

export interface RunPolicies {
  scoring: "IMMEDIATE" | "DELAYED";
  requiresErrorLogOn: string[];
  allowHintsBeforeAnswer: boolean;
  allowEndBreakEarly: boolean;
}

export interface RunMetrics {
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

function policiesForMode(mode: string): RunPolicies {
  switch (mode) {
    case "EXAM_SIM":
      return {
        scoring: "DELAYED",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
    case "ERROR_REPAIR":
    case "INTERLEAVED_PRACTICE":
    case "RETRIEVAL":
    default:
      return {
        scoring: "IMMEDIATE",
        requiresErrorLogOn: ["PARTIAL", "INCORRECT"],
        allowHintsBeforeAnswer: false,
        allowEndBreakEarly: true,
      };
  }
}

function initialPhaseForMode(mode: string): string {
  return mode === "EXAM_SIM" ? "EXAM" : "ACTIVE";
}

// ---- Start / Resume ----

export async function startOrResumeRun(userId: string, sessionId: string) {
  const session = await prisma.session.findUnique({ where: { sessionId } });
  if (!session) return { error: "session_not_found" as const };
  if (session.userId !== userId) return { error: "forbidden" as const };

  // Validate mode is runnable
  if (!(RUNNABLE_MODES as readonly string[]).includes(session.mode)) {
    return { error: "unsupported_mode" as const };
  }

  // Idempotent: return existing active run if present
  const existingRun = await prisma.sessionRun.findFirst({
    where: { sessionId: session.sessionId, userId, status: { in: ["CREATED", "ACTIVE"] } },
    orderBy: { createdAt: "desc" },
  });

  if (existingRun) {
    const breakState = existingRun.breakState as unknown as BreakState;
    const updatedBreakState = checkBreakNeeded(breakState);
    if (updatedBreakState !== breakState) {
      await prisma.sessionRun.update({
        where: { id: existingRun.id },
        data: { breakState: updatedBreakState as object },
      });
    }

    logger.info("run.resumed", {
      user_id: userId,
      session_id: sessionId,
      run_id: existingRun.runId,
      current_index: existingRun.currentIndex,
      mode: existingRun.mode,
      phase: existingRun.phase,
    });

    return {
      data: {
        run_id: existingRun.runId,
        status: existingRun.status,
        mode: existingRun.mode,
        phase: existingRun.phase,
        current_index: existingRun.currentIndex,
        answered_count: existingRun.answeredCount,
        scored_count: existingRun.scoredCount,
        prompts: existingRun.prompts,
        policies: existingRun.policies,
        metrics: existingRun.metrics,
        break_state: updatedBreakState,
        resumed: true,
      },
    };
  }

  // Generate deck based on mode
  const mode = session.mode as RunnableMode;
  const targetOutcome = session.targetOutcome as Record<string, unknown> | null;
  const objectives = session.objectives as { id: string; title: string }[] | null;
  const breakProtocol = session.breakProtocol as { type?: string; cycles?: number } | null;

  const sessionParams = {
    objectives,
    target_outcome: targetOutcome
      ? { prompt_count: targetOutcome.prompt_count as number | undefined }
      : null,
    topic_scope: session.topicScope,
  };

  let prompts: Prompt[];

  switch (mode) {
    case "INTERLEAVED_PRACTICE":
      prompts = generateInterleavedPrompts({
        ...sessionParams,
        seed: session.sessionId,
      });
      break;

    case "EXAM_SIM":
      prompts = generateExamSimPrompts(sessionParams);
      break;

    case "ERROR_REPAIR": {
      const count = (targetOutcome?.prompt_count as number) ?? 10;
      // Fetch unresolved error logs for this user, newest first
      const errorLogs = await prisma.sessionErrorLog.findMany({
        where: {
          run: { userId },
          resolvedAt: null,
        },
        orderBy: { createdAt: "desc" },
        take: count,
        include: {
          run: {
            select: {
              attempts: {
                select: { promptText: true, promptIndex: true },
              },
            },
          },
        },
      });

      const logsForRepair: ErrorLogForRepair[] = errorLogs.map((log) => {
        const attempt = log.run.attempts.find((a) => a.promptIndex === log.promptIndex);
        return {
          id: log.id,
          prompt_index: log.promptIndex,
          error_type: log.errorType,
          correction_rule: log.correctionRule,
          variant_question: log.variantQuestion,
          prompt_text: attempt?.promptText,
        };
      });

      if (logsForRepair.length === 0) {
        // No unresolved errors — generate a minimal retrieval deck instead
        prompts = generateRetrievalPrompts({
          ...sessionParams,
          target_outcome: { prompt_count: Math.min(count, 3) },
        });
      } else {
        prompts = generateErrorRepairPrompts(logsForRepair, count);
      }
      break;
    }

    case "RETRIEVAL":
    default:
      prompts = generateRetrievalPrompts(sessionParams);
      break;
  }

  const runId = generateSessionId();
  const breakState = initBreakState(breakProtocol);
  const metrics = emptyMetrics();
  const policies = policiesForMode(mode);
  const phase = initialPhaseForMode(mode);

  const run = await prisma.sessionRun.create({
    data: {
      runId,
      sessionId: session.sessionId,
      userId,
      mode,
      phase,
      status: "ACTIVE",
      startedAt: new Date(),
      currentIndex: 0,
      answeredCount: mode === "EXAM_SIM" ? 0 : null,
      scoredCount: mode === "EXAM_SIM" ? 0 : null,
      prompts: prompts as object[],
      policies: policies as object,
      metrics: metrics as object,
      breakState: breakState as object,
    },
  });

  logger.info("run.started", {
    user_id: userId,
    session_id: sessionId,
    run_id: run.runId,
    mode,
    phase,
    prompt_count: prompts.length,
    break_type: breakProtocol?.type ?? "50_10",
  });

  return {
    data: {
      run_id: run.runId,
      status: run.status,
      mode,
      phase,
      current_index: 0,
      answered_count: mode === "EXAM_SIM" ? 0 : null,
      scored_count: mode === "EXAM_SIM" ? 0 : null,
      prompts,
      policies,
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
      mode: run.mode,
      phase: run.phase,
      current_index: run.currentIndex,
      answered_count: run.answeredCount,
      scored_count: run.scoredCount,
      prompts: run.prompts,
      policies: run.policies,
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

// ---- Submit Attempt (unified for all modes) ----

export async function submitAttempt(userId: string, runId: string, input: AttemptPayload) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };
  if (run.status === "COMPLETED") return { error: "run_completed" as const };

  const mode = run.mode;
  const phase = run.phase;

  // Determine attempt kind
  const kind = "kind" in input && input.kind ? input.kind : "LEGACY";

  // Phase compatibility
  if (mode === "EXAM_SIM") {
    if (phase === "EXAM" && kind === "SCORE") {
      return { error: "wrong_phase" as const, message: "Cannot score during EXAM phase" };
    }
    if (phase === "REVIEW" && (kind === "ANSWER" || kind === "LEGACY")) {
      return { error: "wrong_phase" as const, message: "Cannot answer during REVIEW phase" };
    }
  }

  // Check break state
  const breakState = checkBreakNeeded(run.breakState as unknown as BreakState);
  if (breakState.on_break) {
    await prisma.sessionRun.update({
      where: { id: run.id },
      data: { breakState: breakState as object },
    });
    logger.info("break.started", { run_id: runId, user_id: userId });
    return { error: "on_break" as const, break_state: breakState };
  }

  const promptIndex = input.prompt_index;

  // Enforce linear flow
  if (promptIndex !== run.currentIndex) {
    return { error: "wrong_index" as const, expected: run.currentIndex };
  }

  const prompts = run.prompts as unknown as Prompt[];
  const prompt = prompts[promptIndex];
  if (!prompt) return { error: "invalid_index" as const };

  // Route to the appropriate handler
  if (mode === "EXAM_SIM" && (kind === "ANSWER" || (kind === "LEGACY" && phase === "EXAM"))) {
    return handleExamAnswer(run, prompt, input as ExamAnswerInput | SubmitAttemptInput, breakState);
  }

  if (mode === "EXAM_SIM" && (kind === "SCORE" || (kind === "LEGACY" && phase === "REVIEW"))) {
    return handleExamScore(run, prompt, input as ExamScoreInput | SubmitAttemptInput, breakState, userId);
  }

  // RETRIEVAL / INTERLEAVED / ERROR_REPAIR: immediate scoring
  return handleImmediateScoring(run, prompt, input as SubmitAttemptInput, breakState, userId);
}

// ---- Immediate scoring (RETRIEVAL / INTERLEAVED / ERROR_REPAIR) ----

async function handleImmediateScoring(
  run: { id: string; runId: string; userId: string; currentIndex: number; mode: string; metrics: unknown; breakState: unknown },
  prompt: Prompt,
  input: SubmitAttemptInput,
  breakState: BreakState,
  userId: string
) {
  // Check for duplicate attempt
  const existing = await prisma.sessionAttempt.findUnique({
    where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
  });
  if (existing) return { error: "duplicate_attempt" as const };

  const prompts = (await prisma.sessionRun.findUnique({ where: { id: run.id }, select: { prompts: true } }))!.prompts as unknown as Prompt[];
  const metrics = run.metrics as unknown as RunMetrics;
  const newMetrics: RunMetrics = {
    attempts_count: metrics.attempts_count + 1,
    correct_count: metrics.correct_count + (input.self_score === "CORRECT" ? 1 : 0),
    partial_count: metrics.partial_count + (input.self_score === "PARTIAL" ? 1 : 0),
    incorrect_count: metrics.incorrect_count + (input.self_score === "INCORRECT" ? 1 : 0),
    accuracy: 0,
    time_spent_seconds: metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
  };
  newMetrics.accuracy = newMetrics.attempts_count > 0
    ? newMetrics.correct_count / newMetrics.attempts_count
    : 0;

  const newIndex = run.currentIndex + 1;
  const isLastPrompt = newIndex >= prompts.length;
  const updatedBreakState = isLastPrompt ? breakState : checkBreakNeeded(breakState);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.sessionAttempt.create({
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

      if (
        (input.self_score === "PARTIAL" || input.self_score === "INCORRECT") &&
        input.error_log
      ) {
        await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: input.error_log.error_type,
            correctionRule: input.error_log.correction_rule,
            variantQuestion: input.error_log.variant_question ?? null,
          },
        });
      }

      // ERROR_REPAIR: resolve the linked error log on CORRECT
      if (run.mode === "ERROR_REPAIR" && input.self_score === "CORRECT" && prompt.meta?.source_error_log_id) {
        await tx.sessionErrorLog.update({
          where: { id: prompt.meta.source_error_log_id },
          data: {
            resolvedAt: new Date(),
            resolvedByRunId: run.runId,
          },
        });
      }

      const metricsToStore = isLastPrompt
        ? { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) }
        : newMetrics;

      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: newIndex,
          metrics: metricsToStore as object,
          breakState: updatedBreakState as object,
          status: isLastPrompt ? "COMPLETED" : "ACTIVE",
          phase: isLastPrompt ? "COMPLETE" : undefined,
          endedAt: isLastPrompt ? new Date() : undefined,
        },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    captureException(err, { user_id: userId, run_id: run.runId, action: "submitAttempt" });
    throw err;
  }

  logger.info("prompt.submitted", {
    user_id: userId,
    run_id: run.runId,
    prompt_index: input.prompt_index,
    self_score: input.self_score,
    mode: run.mode,
    is_last: isLastPrompt,
  });

  if (isLastPrompt) {
    const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
    logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });
    return {
      data: {
        status: "COMPLETED" as const,
        phase: "COMPLETE",
        current_index: newIndex,
        metrics: finalMetrics,
        break_state: updatedBreakState,
      },
    };
  }

  return {
    data: {
      status: "ACTIVE" as const,
      phase: "ACTIVE",
      current_index: newIndex,
      metrics: newMetrics,
      break_state: updatedBreakState,
    },
  };
}

// ---- EXAM_SIM: EXAM phase (answer only, no scoring) ----

async function handleExamAnswer(
  run: { id: string; runId: string; userId: string; currentIndex: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown },
  prompt: Prompt,
  input: ExamAnswerInput | SubmitAttemptInput,
  breakState: BreakState
) {
  const userAnswer = "user_answer" in input ? input.user_answer : "";
  const timeToAnswer = "time_to_answer_seconds" in input ? input.time_to_answer_seconds : undefined;

  // Check for duplicate
  const existing = await prisma.sessionAttempt.findUnique({
    where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
  });
  if (existing) return { error: "duplicate_attempt" as const };

  const prompts = (await prisma.sessionRun.findUnique({ where: { id: run.id }, select: { prompts: true } }))!.prompts as unknown as Prompt[];
  const newIndex = run.currentIndex + 1;
  const newAnsweredCount = (run.answeredCount ?? 0) + 1;
  const isLastAnswer = newIndex >= prompts.length;
  const updatedBreakState = isLastAnswer ? breakState : checkBreakNeeded(breakState);

  const metrics = run.metrics as unknown as RunMetrics;
  const newMetrics: RunMetrics = {
    ...metrics,
    time_spent_seconds: metrics.time_spent_seconds + (timeToAnswer ?? 0),
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Insert attempt with self_score = null
      await tx.sessionAttempt.create({
        data: {
          runId: run.runId,
          promptIndex: input.prompt_index,
          promptId: prompt.id,
          promptText: prompt.text,
          userAnswer,
          selfScore: null,
          timeToAnswerSeconds: timeToAnswer ?? null,
        },
      });

      // Transition to REVIEW phase after last answer
      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: isLastAnswer ? 0 : newIndex,
          answeredCount: newAnsweredCount,
          metrics: newMetrics as object,
          breakState: updatedBreakState as object,
          phase: isLastAnswer ? "REVIEW" : "EXAM",
        },
      });
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    throw err;
  }

  logger.info("prompt.submitted", {
    user_id: run.userId,
    run_id: run.runId,
    prompt_index: input.prompt_index,
    mode: "EXAM_SIM",
    phase: isLastAnswer ? "REVIEW" : "EXAM",
    is_last_answer: isLastAnswer,
  });

  return {
    data: {
      status: "ACTIVE" as const,
      phase: isLastAnswer ? "REVIEW" : "EXAM",
      current_index: isLastAnswer ? 0 : newIndex,
      answered_count: newAnsweredCount,
      scored_count: run.scoredCount ?? 0,
      metrics: newMetrics,
      break_state: updatedBreakState,
    },
  };
}

// ---- EXAM_SIM: REVIEW phase (score existing attempt) ----

async function handleExamScore(
  run: { id: string; runId: string; userId: string; currentIndex: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown },
  prompt: Prompt,
  input: ExamScoreInput | SubmitAttemptInput,
  breakState: BreakState,
  userId: string
) {
  const selfScore = "self_score" in input ? input.self_score : null;
  const errorLog = "error_log" in input ? input.error_log : undefined;

  if (!selfScore) return { error: "missing_score" as const };

  // Find existing attempt (must exist from EXAM phase)
  const existing = await prisma.sessionAttempt.findUnique({
    where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
  });
  if (!existing) return { error: "no_attempt_to_score" as const };
  if (existing.selfScore !== null) return { error: "already_scored" as const };

  const prompts = (await prisma.sessionRun.findUnique({ where: { id: run.id }, select: { prompts: true } }))!.prompts as unknown as Prompt[];
  const metrics = run.metrics as unknown as RunMetrics;
  const newScoredCount = (run.scoredCount ?? 0) + 1;
  const newIndex = run.currentIndex + 1;
  const isLastScore = newIndex >= prompts.length;

  const newMetrics: RunMetrics = {
    attempts_count: metrics.attempts_count + 1,
    correct_count: metrics.correct_count + (selfScore === "CORRECT" ? 1 : 0),
    partial_count: metrics.partial_count + (selfScore === "PARTIAL" ? 1 : 0),
    incorrect_count: metrics.incorrect_count + (selfScore === "INCORRECT" ? 1 : 0),
    accuracy: 0,
    time_spent_seconds: metrics.time_spent_seconds,
  };
  newMetrics.accuracy = newMetrics.attempts_count > 0
    ? newMetrics.correct_count / newMetrics.attempts_count
    : 0;

  try {
    await prisma.$transaction(async (tx) => {
      // Update existing attempt with score
      await tx.sessionAttempt.update({
        where: { id: existing.id },
        data: { selfScore },
      });

      // Insert error log if needed
      if ((selfScore === "PARTIAL" || selfScore === "INCORRECT") && errorLog) {
        await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: errorLog.error_type,
            correctionRule: errorLog.correction_rule,
            variantQuestion: errorLog.variant_question ?? null,
          },
        });
      }

      const metricsToStore = isLastScore
        ? { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) }
        : newMetrics;

      await tx.sessionRun.update({
        where: { id: run.id },
        data: {
          currentIndex: newIndex,
          scoredCount: newScoredCount,
          metrics: metricsToStore as object,
          status: isLastScore ? "COMPLETED" : "ACTIVE",
          phase: isLastScore ? "COMPLETE" : "REVIEW",
          endedAt: isLastScore ? new Date() : undefined,
        },
      });
    });
  } catch (err: unknown) {
    captureException(err, { user_id: userId, run_id: run.runId, action: "examScore" });
    throw err;
  }

  logger.info("prompt.scored", {
    user_id: userId,
    run_id: run.runId,
    prompt_index: input.prompt_index,
    self_score: selfScore,
    mode: "EXAM_SIM",
    is_last_score: isLastScore,
  });

  if (isLastScore) {
    const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
    logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });
    return {
      data: {
        status: "COMPLETED" as const,
        phase: "COMPLETE",
        current_index: newIndex,
        answered_count: run.answeredCount,
        scored_count: newScoredCount,
        metrics: finalMetrics,
        break_state: breakState,
      },
    };
  }

  return {
    data: {
      status: "ACTIVE" as const,
      phase: "REVIEW",
      current_index: newIndex,
      answered_count: run.answeredCount,
      scored_count: newScoredCount,
      metrics: newMetrics,
      break_state: breakState,
    },
  };
}

// ---- Complete Run (idempotent) ----

export async function completeRun(userId: string, runId: string) {
  const run = await prisma.sessionRun.findUnique({ where: { runId } });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  if (run.status === "COMPLETED") {
    const metrics = run.metrics as unknown as RunMetrics;
    return {
      data: {
        run_id: run.runId,
        status: "COMPLETED" as const,
        metrics,
        started_at: run.startedAt?.toISOString() ?? null,
        ended_at: run.endedAt?.toISOString() ?? null,
      },
    };
  }

  const metrics = run.metrics as unknown as RunMetrics;
  const followups = computeFollowups(metrics.accuracy);
  const finalMetrics = { ...metrics, recommended_followups: followups };
  const endedAt = new Date();

  await prisma.sessionRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      phase: "COMPLETE",
      endedAt,
      metrics: finalMetrics as object,
    },
  });

  logger.info("run.completed", {
    user_id: userId,
    run_id: runId,
    accuracy: finalMetrics.accuracy,
    attempts_count: finalMetrics.attempts_count,
    manual: true,
  });

  return {
    data: {
      run_id: run.runId,
      status: "COMPLETED" as const,
      metrics: finalMetrics,
      started_at: run.startedAt?.toISOString() ?? null,
      ended_at: endedAt.toISOString(),
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

  logger.info("break.ended", {
    user_id: userId,
    run_id: runId,
    cycle: newState.current_cycle,
    early: true,
  });

  return { data: { break_state: newState } };
}
