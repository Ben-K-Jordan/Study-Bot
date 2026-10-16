/**
 * Submitting an attempt: immediate scoring, exam answers and exam scores.
 */
import { prisma } from "@/lib/db";
import type { Prompt } from "@/lib/prompts";
import { generateFeedbackEager } from "@/services/feedback";
import { checkBreakNeeded, type BreakState } from "@/lib/breaks";
import { computeFollowups } from "@/lib/spacing";
import { logger } from "@/lib/logger";
import { captureException } from "@/lib/error-reporter";
import type { SubmitAttemptInput, ExamAnswerInput, ExamScoreInput, AttemptPayload } from "@/lib/validation";
import { generateVariantQuestion, MAX_VARIANTS_PER_SESSION } from "@/lib/variant-questions";
import { dayKey, getUserTimezone } from "@/lib/timezone";
import { DuplicateAttemptError, RunCompletedError, WrongIndexError, emptyMetrics, type RunMetrics } from "./shared";
import { runPostCompletionEffects } from "./complete";
import { committedAnswerOf } from "./reveal";

// ---- Submit Attempt (unified for all modes) ----

export async function submitAttempt(userId: string, runId: string, input: AttemptPayload) {
  const txStart = Date.now();
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
      return { error: "wrong_phase" as const, message: "Scoring starts after the last question of the exam simulation. Reload to continue." };
    }
    if (phase === "REVIEW" && (kind === "ANSWER" || kind === "LEGACY")) {
      return { error: "wrong_phase" as const, message: "This exam simulation is in scoring now. Reload to continue." };
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

  // Read prompt from normalized table, fall back to JSONB
  const prompts = run.prompts as unknown as Prompt[];
  const promptRow = await prisma.sessionRunPrompt.findUnique({
    where: { runId_promptIndex: { runId, promptIndex } },
  });
  const prompt: Prompt = promptRow
    ? (() => {
        const rowMeta = promptRow.meta as Record<string, unknown> | null;
        return {
          id: promptRow.id,
          text: promptRow.text,
          objective_id: promptRow.objectiveId ?? undefined,
          difficulty: promptRow.difficulty,
          format: rowMeta?.format as Prompt["format"],
          choices: rowMeta?.choices as string[] | undefined,
          correctIndex: rowMeta?.correctIndex as number | undefined,
          meta: rowMeta as Prompt["meta"],
        };
      })()
    : prompts[promptIndex];
  if (!prompt) return { error: "invalid_index" as const };

  // Route to the appropriate handler
  if (mode === "EXAM_SIM" && (kind === "ANSWER" || (kind === "LEGACY" && phase === "EXAM"))) {
    return handleExamAnswer(run, prompt, input as ExamAnswerInput | SubmitAttemptInput, breakState, txStart);
  }

  if (mode === "EXAM_SIM" && (kind === "SCORE" || (kind === "LEGACY" && phase === "REVIEW"))) {
    return handleExamScore(run, prompt, input as ExamScoreInput | SubmitAttemptInput, breakState, userId, txStart);
  }

  // RETRIEVAL / INTERLEAVED / ERROR_REPAIR: immediate scoring
  return handleImmediateScoring(run, prompt, input as SubmitAttemptInput, breakState, userId, txStart);
}

/**
 * The question a repair variant retests. A repair prompt carries the
 * question it repairs in meta.original_prompt_text, so a missed repair is
 * retested against that question instead of quoting the repair's own
 * wording inside a new repair. An MCQ stem says "which of the following",
 * so its choices come along (never which one is right: the variant is a
 * retest, not a reveal).
 */
export function variantSourceFor(prompt: Pick<Prompt, "text" | "format" | "choices" | "meta">): string {
  const original = prompt.meta?.original_prompt_text?.trim();
  if (original) return original;
  if (prompt.format === "MCQ" && prompt.choices && prompt.choices.length > 0) {
    const choices = prompt.choices
      .map((choice, i) => `${String.fromCharCode(65 + i)}. ${choice}`)
      .join("; ");
    return `${prompt.text} (Choices: ${choices})`;
  }
  return prompt.text;
}

async function handleImmediateScoring(
  run: { id: string; runId: string; userId: string; sessionId: string; currentIndex: number; promptCount: number; mode: string; metrics: unknown; breakState: unknown; prompts: unknown },
  prompt: Prompt,
  input: SubmitAttemptInput,
  breakState: BreakState,
  userId: string,
  txStart: number
) {
  // ---- Server-side MCQ grading ----
  // The client never receives the answer key, so it submits only the chosen
  // index. The server grades against the stored correctIndex and builds the
  // error log from the correct answer (never from the distractor's
  // misconception rationale alone — that would drill the misconception).
  let effectiveScore = input.self_score;
  let effectiveErrorLog = input.error_log;
  let mcqResult:
    | { selected_index: number; correct_index: number; is_correct: boolean; correct_choice: string; rationale?: string }
    | null = null;

  if (
    prompt.format === "MCQ" &&
    prompt.choices &&
    prompt.correctIndex != null &&
    input.mcq_choice_index != null &&
    input.mcq_choice_index < prompt.choices.length
  ) {
    const selected = input.mcq_choice_index;
    const isCorrect = selected === prompt.correctIndex;
    const correctChoice = prompt.choices[prompt.correctIndex];
    const rationale = isCorrect ? undefined : prompt.meta?.distractorRationales?.[selected];

    effectiveScore = isCorrect ? "CORRECT" : "INCORRECT";
    if (!isCorrect) {
      effectiveErrorLog = {
        error_type: "MISCONCEPTION",
        correction_rule: `The correct answer is "${correctChoice}".${rationale ? ` Common trap: ${rationale}` : ""}`,
      };
    }
    mcqResult = {
      selected_index: selected,
      correct_index: prompt.correctIndex,
      is_correct: isCorrect,
      correct_choice: correctChoice,
      rationale,
    };
  }

  if (!effectiveScore) return { error: "missing_score" as const };
  const finalScoreValue = effectiveScore;
  const finalErrorLog = effectiveErrorLog;

  // A free-recall answer committed to see the model answer is the one that
  // gets recorded: seeing the standard must not let the answer change.
  const committedAnswer = mcqResult ? null : committedAnswerOf(prompt.meta);
  const recordedAnswer = committedAnswer ?? input.user_answer;

  // The relearning criterion compares calendar days in the student's
  // timezone (null = UTC). Fetched outside the transaction; single indexed
  // row lookup.
  const userTz = prompt.meta?.source_error_log_id
    ? await getUserTimezone(userId)
    : null;

  // Server-stored prompt meta is authoritative (never trust client flags):
  // pretest items are diagnostic — quarantined from accuracy, error logs,
  // variant injection, and mastery (Richland et al. 2009: pretesting helps
  // even when answers are wrong, so wrong answers must not be punished).
  const isPretest = prompt.meta?.pack === "PRE_TEST";
  // Repair prompts (variants, cross-session repairs, ERROR_REPAIR decks)
  // link back to a source error log and never mint a NEW error log.
  const sourceErrorLogId = prompt.meta?.source_error_log_id;

  let attemptId: string;
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction to get fresh metrics/index and prevent
      // concurrent submissions from clobbering each other.
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });

      // A concurrent completeRun may have finished the run since the
      // pre-transaction check — never resurrect a completed run.
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      // Check for duplicate attempt
      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (existing) throw new DuplicateAttemptError();

      // Re-validate index against fresh state
      if (input.prompt_index !== fresh.currentIndex) {
        throw new WrongIndexError(fresh.currentIndex);
      }

      const promptCount = fresh.promptCount || (Array.isArray(fresh.prompts) ? (fresh.prompts as unknown as Prompt[]).length : 0);
      const metrics: RunMetrics = { ...emptyMetrics(), ...(fresh.metrics as object) };
      const freshBreak = fresh.breakState as unknown as BreakState;
      const newMetrics: RunMetrics = isPretest
        ? {
            ...metrics,
            time_spent_seconds: metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
            pretest_count: (metrics.pretest_count ?? 0) + 1,
            pretest_correct: (metrics.pretest_correct ?? 0) + (finalScoreValue === "CORRECT" ? 1 : 0),
          }
        : {
            ...metrics,
            attempts_count: metrics.attempts_count + 1,
            correct_count: metrics.correct_count + (finalScoreValue === "CORRECT" ? 1 : 0),
            partial_count: metrics.partial_count + (finalScoreValue === "PARTIAL" ? 1 : 0),
            incorrect_count: metrics.incorrect_count + (finalScoreValue === "INCORRECT" ? 1 : 0),
            accuracy: 0,
            time_spent_seconds: metrics.time_spent_seconds + (input.time_to_answer_seconds ?? 0),
          };
      if (!isPretest) {
        newMetrics.accuracy = newMetrics.attempts_count > 0
          ? newMetrics.correct_count / newMetrics.attempts_count
          : 0;
      }

      const newIndex = fresh.currentIndex + 1;
      const isLastPrompt = newIndex >= promptCount;
      const updatedBreakState = isLastPrompt ? freshBreak : checkBreakNeeded(freshBreak);

      const attempt = await tx.sessionAttempt.create({
        data: {
          runId: run.runId,
          promptIndex: input.prompt_index,
          promptId: prompt.id,
          promptText: prompt.text,
          userAnswer: recordedAnswer,
          selfScore: finalScoreValue,
          timeToAnswerSeconds: input.time_to_answer_seconds ?? null,
          confidenceRating: input.confidence_rating ?? null,
          selfExplanation: input.self_explanation ?? null,
          generatedExample: input.generated_example ?? null,
        },
      });

      // Error logs: only for genuine (non-pretest) errors on prompts that
      // aren't already repairing an existing error. Confidence is stored for
      // hypercorrection prioritization (Butterfield & Metcalfe 2001).
      let errorLogId: string | undefined;
      if (
        (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT") &&
        finalErrorLog &&
        !isPretest &&
        !sourceErrorLogId
      ) {
        const errorLog = await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: finalErrorLog.error_type,
            correctionRule: finalErrorLog.correction_rule,
            variantQuestion: finalErrorLog.variant_question ?? null,
            confidenceRating: input.confidence_rating ?? null,
          },
        });
        errorLogId = errorLog.id;
      }

      // Criterion-based successive relearning (Rawson & Dunlosky 2011):
      // a linked error log resolves only after TWO correct retrievals on
      // DIFFERENT days — one lucky in-session hit is not mastery. A wrong
      // answer on a repair prompt resets the streak.
      if (sourceErrorLogId && !isPretest) {
        if (finalScoreValue === "CORRECT") {
          const srcLog = await tx.sessionErrorLog.findUnique({
            where: { id: sourceErrorLogId },
          });
          if (srcLog && !srcLog.resolvedAt) {
            const now = new Date();
            // Calendar days follow the student's clock (11pm miss + 7am
            // repair should count as different days for THEM); null tz = UTC.
            const today = dayKey(now, userTz);
            const lastDay = srcLog.lastCorrectAt
              ? dayKey(srcLog.lastCorrectAt, userTz)
              : null;
            // At most one streak increment per calendar day
            if (lastDay !== today) {
              const newStreak = srcLog.correctStreak + 1;
              await tx.sessionErrorLog.update({
                where: { id: srcLog.id },
                data: {
                  correctStreak: newStreak,
                  lastCorrectAt: now,
                  ...(newStreak >= 2
                    ? { resolvedAt: now, resolvedByRunId: run.runId }
                    : {}),
                },
              });
            }
          }
        } else {
          await tx.sessionErrorLog.updateMany({
            where: { id: sourceErrorLogId, resolvedAt: null },
            data: { correctStreak: 0 },
          });
        }
      }

      // ---- In-session error repair: inject variant question ----
      // When the student gets a question wrong, append a variant question to the
      // end of the deck. This provides natural spacing (1-3 intervening items)
      // before the retry, which research shows enhances the retrieval effect
      // (Kornell & Bjork 2008).
      // In-session repair loop: a wrong answer injects a spaced retry variant
      // at the end of the deck (Kornell & Bjork 2008). A wrong answer ON a
      // repair prompt re-injects for the SAME source error (criterion loop) —
      // the session doesn't end until each miss gets a correct retrieval or
      // the cap is hit. Pretest misses never inject (they aren't errors yet).
      let variantInjected = false;
      let finalPromptCount = promptCount;
      const repairSourceId = sourceErrorLogId ?? errorLogId;
      if (
        (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT") &&
        (finalErrorLog || sourceErrorLogId) &&
        !isPretest &&
        run.mode !== "ERROR_REPAIR" // ERROR_REPAIR already has targeted repair prompts
      ) {
        // Count existing variants in this session to cap injection
        const existingVariants = await tx.sessionRunPrompt.count({
          where: { runId: run.runId, sourceType: "VARIANT_REPAIR" },
        });

        if (existingVariants < MAX_VARIANTS_PER_SESSION) {
          const variantSourceText = variantSourceFor(prompt);
          const variantPrompt = generateVariantQuestion(
            promptCount, // append at end of current deck
            variantSourceText,
            finalErrorLog?.error_type ?? "MISCONCEPTION",
            finalErrorLog?.correction_rule ?? prompt.meta?.expected_correction_rule ?? "",
            prompt.objective_id,
            repairSourceId,
          );

          await tx.sessionRunPrompt.create({
            data: {
              runId: run.runId,
              promptIndex: promptCount,
              objectiveId: variantPrompt.objective_id ?? null,
              text: variantPrompt.text,
              difficulty: variantPrompt.difficulty,
              sourceType: "VARIANT_REPAIR",
              sourceRefId: repairSourceId ?? null,
              meta: variantPrompt.meta ? (variantPrompt.meta as object) : undefined,
            },
          });

          finalPromptCount = promptCount + 1;
          variantInjected = true;
        }
      }

      const isLastPromptFinal = newIndex >= finalPromptCount;
      const updatedBreakStateFinal = isLastPromptFinal ? freshBreak : updatedBreakState;

      const metricsToStore = isLastPromptFinal
        ? { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) }
        : newMetrics;

      // Guarded update: under READ COMMITTED a concurrent completeRun may
      // have committed the ACTIVE -> COMPLETED transition after our fresh
      // read above. The status filter makes this update claim the transition
      // atomically — if another caller already completed the run, count is 0
      // and we bail (RunCompletedError) instead of resurrecting the run or
      // double-running post-completion effects (double SM-2 advance).
      const updated = await tx.sessionRun.updateMany({
        where: { id: run.id, status: { not: "COMPLETED" } },
        data: {
          currentIndex: newIndex,
          promptCount: finalPromptCount,
          metrics: metricsToStore as object,
          breakState: updatedBreakStateFinal as object,
          status: isLastPromptFinal ? "COMPLETED" : "ACTIVE",
          phase: isLastPromptFinal ? "COMPLETE" : undefined,
          endedAt: isLastPromptFinal ? new Date() : undefined,
        },
      });
      if (updated.count === 0) throw new RunCompletedError();

      return { attemptId: attempt.id, newMetrics, newIndex, promptCount: finalPromptCount, isLastPrompt: isLastPromptFinal, updatedBreakState: updatedBreakStateFinal, variantInjected };
    });
    attemptId = txResult.attemptId;
    const { newMetrics, newIndex, promptCount, isLastPrompt, updatedBreakState, variantInjected } = txResult;

    // Eager feedback (Kulik & Kulik 1988 — immediate feedback default):
    // start generating elaborated feedback the moment the attempt lands so
    // the review panel barely waits. Fire-and-forget; the GET endpoint is
    // the fallback and the claim in generateFeedbackEager prevents doubles.
    void generateFeedbackEager(userId, attemptId).catch(() => {});

    const dbTxMs = Date.now() - txStart;
    const feedbackStatus = (finalScoreValue === "PARTIAL" || finalScoreValue === "INCORRECT")
      ? "PENDING" as const
      : "NONE" as const;

    logger.info("prompt.submitted", {
      user_id: userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      self_score: finalScoreValue,
      mode: run.mode,
      is_last: isLastPrompt,
      variant_injected: variantInjected,
      mcq_graded: mcqResult != null,
      db_tx_ms: dbTxMs,
    });

    if (isLastPrompt) {
      const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
      logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });

      await runPostCompletionEffects(userId, run.runId, run.sessionId, finalMetrics);

      return {
        data: {
          attempt_id: attemptId,
          feedback_status: feedbackStatus,
          status: "COMPLETED" as const,
          phase: "COMPLETE",
          current_index: newIndex,
          prompt_count: promptCount,
          metrics: finalMetrics,
          break_state: updatedBreakState,
          mcq_result: mcqResult,
        },
      };
    }

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: feedbackStatus,
        status: "ACTIVE" as const,
        phase: "ACTIVE",
        current_index: newIndex,
        prompt_count: promptCount,
        metrics: newMetrics,
        break_state: updatedBreakState,
        mcq_result: mcqResult,
      },
    };
  } catch (err: unknown) {
    if (err instanceof DuplicateAttemptError) return { error: "duplicate_attempt" as const };
    if (err instanceof WrongIndexError) return { error: "wrong_index" as const, expected: err.expected };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    captureException(err, { user_id: userId, run_id: run.runId, action: "submitAttempt" });
    throw err;
  }
}

// ---- EXAM_SIM: EXAM phase (answer only, no scoring) ----

async function handleExamAnswer(
  run: { id: string; runId: string; userId: string; currentIndex: number; promptCount: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown; prompts: unknown },
  prompt: Prompt,
  input: ExamAnswerInput | SubmitAttemptInput,
  breakState: BreakState,
  txStart: number
) {
  const userAnswer = "user_answer" in input ? input.user_answer : "";
  const timeToAnswer = "time_to_answer_seconds" in input ? input.time_to_answer_seconds : undefined;
  const confidenceRating = "confidence_rating" in input ? input.confidence_rating : undefined;

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (existing) throw new DuplicateAttemptError();

      const promptCount = fresh.promptCount || (fresh.prompts as unknown as Prompt[]).length;
      const freshBreak = fresh.breakState as unknown as BreakState;
      const newIndex = fresh.currentIndex + 1;
      const newAnsweredCount = (fresh.answeredCount ?? 0) + 1;
      const isLastAnswer = newIndex >= promptCount;
      const updatedBreakState = isLastAnswer ? freshBreak : checkBreakNeeded(freshBreak);

      const metrics: RunMetrics = { ...emptyMetrics(), ...(fresh.metrics as object) };
      const newMetrics: RunMetrics = {
        ...metrics,
        time_spent_seconds: metrics.time_spent_seconds + (timeToAnswer ?? 0),
      };

      const attempt = await tx.sessionAttempt.create({
        data: {
          runId: run.runId,
          promptIndex: input.prompt_index,
          promptId: prompt.id,
          promptText: prompt.text,
          userAnswer,
          selfScore: null,
          timeToAnswerSeconds: timeToAnswer ?? null,
          confidenceRating: confidenceRating ?? null,
        },
      });

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

      return { attemptId: attempt.id, promptCount, newIndex, newAnsweredCount, isLastAnswer, updatedBreakState, newMetrics };
    });

    const { attemptId, promptCount, newIndex, newAnsweredCount, isLastAnswer, updatedBreakState, newMetrics } = txResult;

    const dbTxMs = Date.now() - txStart;
    logger.info("prompt.submitted", {
      user_id: run.userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      mode: "EXAM_SIM",
      phase: isLastAnswer ? "REVIEW" : "EXAM",
      is_last_answer: isLastAnswer,
      db_tx_ms: dbTxMs,
    });

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: "NONE" as const,
        status: "ACTIVE" as const,
        phase: isLastAnswer ? "REVIEW" : "EXAM",
        current_index: isLastAnswer ? 0 : newIndex,
        prompt_count: promptCount,
        answered_count: newAnsweredCount,
        scored_count: run.scoredCount ?? 0,
        metrics: newMetrics,
        break_state: updatedBreakState,
      },
    };
  } catch (err: unknown) {
    if (err instanceof DuplicateAttemptError) return { error: "duplicate_attempt" as const };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return { error: "duplicate_attempt" as const };
    }
    throw err;
  }
}

// ---- EXAM_SIM: REVIEW phase (score existing attempt) ----

async function handleExamScore(
  run: { id: string; runId: string; userId: string; sessionId: string; currentIndex: number; promptCount: number; answeredCount: number | null; scoredCount: number | null; metrics: unknown; breakState: unknown; prompts: unknown },
  _prompt: Prompt,
  input: ExamScoreInput | SubmitAttemptInput,
  breakState: BreakState,
  userId: string,
  txStart: number
) {
  const selfScore = "self_score" in input ? input.self_score : null;
  const errorLog = "error_log" in input ? input.error_log : undefined;
  const selfExplanation = "self_explanation" in input ? input.self_explanation : undefined;
  const generatedExample = "generated_example" in input ? input.generated_example : undefined;

  if (!selfScore) return { error: "missing_score" as const };

  try {
    const txResult = await prisma.$transaction(async (tx) => {
      // Re-read inside the transaction to get fresh metrics/index
      const fresh = await tx.sessionRun.findUniqueOrThrow({ where: { id: run.id } });
      if (fresh.status === "COMPLETED") throw new RunCompletedError();

      // Find existing attempt (must exist from EXAM phase)
      const existing = await tx.sessionAttempt.findUnique({
        where: { runId_promptIndex: { runId: run.runId, promptIndex: input.prompt_index } },
      });
      if (!existing) throw new Error("no_attempt_to_score");
      if (existing.selfScore !== null) throw new Error("already_scored");

      const promptCount = fresh.promptCount || (Array.isArray(fresh.prompts) ? (fresh.prompts as unknown as Prompt[]).length : 0);
      const metrics: RunMetrics = { ...emptyMetrics(), ...(fresh.metrics as object) };
      const newScoredCount = (fresh.scoredCount ?? 0) + 1;
      const newIndex = fresh.currentIndex + 1;
      const isLastScore = newIndex >= promptCount;

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

      // Update existing attempt with score and metacognitive fields
      await tx.sessionAttempt.update({
        where: { id: existing.id },
        data: {
          selfScore,
          selfExplanation: selfExplanation ?? undefined,
          generatedExample: generatedExample ?? undefined,
        },
      });

      // Insert error log if needed — carrying the exam-time confidence for
      // hypercorrection prioritization (Butterfield & Metcalfe 2001).
      if ((selfScore === "PARTIAL" || selfScore === "INCORRECT") && errorLog) {
        await tx.sessionErrorLog.create({
          data: {
            runId: run.runId,
            userId: run.userId,
            promptIndex: input.prompt_index,
            errorType: errorLog.error_type,
            correctionRule: errorLog.correction_rule,
            variantQuestion: errorLog.variant_question ?? null,
            confidenceRating: existing.confidenceRating ?? null,
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

      return { attemptId: existing.id, newMetrics, newIndex, promptCount, newScoredCount, isLastScore, answeredCount: fresh.answeredCount };
    });

    const { attemptId, newMetrics, newIndex, promptCount, newScoredCount, isLastScore, answeredCount } = txResult;

    // Eager feedback: start generation as soon as the score lands.
    void generateFeedbackEager(userId, attemptId).catch(() => {});

    const dbTxMs = Date.now() - txStart;
    const feedbackStatus = (selfScore === "PARTIAL" || selfScore === "INCORRECT")
      ? "PENDING" as const
      : "NONE" as const;

    logger.info("prompt.scored", {
      user_id: userId,
      run_id: run.runId,
      prompt_index: input.prompt_index,
      self_score: selfScore,
      mode: "EXAM_SIM",
      is_last_score: isLastScore,
      db_tx_ms: dbTxMs,
    });

    if (isLastScore) {
      const finalMetrics = { ...newMetrics, recommended_followups: computeFollowups(newMetrics.accuracy) };
      logger.info("run.completed", { user_id: userId, run_id: run.runId, accuracy: finalMetrics.accuracy });

      await runPostCompletionEffects(userId, run.runId, run.sessionId, finalMetrics);

      return {
        data: {
          attempt_id: attemptId,
          feedback_status: feedbackStatus,
          status: "COMPLETED" as const,
          phase: "COMPLETE",
          current_index: newIndex,
          prompt_count: promptCount,
          answered_count: answeredCount,
          scored_count: newScoredCount,
          metrics: finalMetrics,
          break_state: breakState,
        },
      };
    }

    return {
      data: {
        attempt_id: attemptId,
        feedback_status: feedbackStatus,
        status: "ACTIVE" as const,
        phase: "REVIEW",
        current_index: newIndex,
        prompt_count: promptCount,
        answered_count: answeredCount,
        scored_count: newScoredCount,
        metrics: newMetrics,
        break_state: breakState,
      },
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "no_attempt_to_score") return { error: "no_attempt_to_score" as const };
    if (err instanceof Error && err.message === "already_scored") return { error: "already_scored" as const };
    if (err instanceof RunCompletedError) return { error: "run_completed" as const };
    captureException(err, { user_id: userId, run_id: run.runId, action: "examScore" });
    throw err;
  }
}
