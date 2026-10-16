/**
 * When the model answer may be shown, and the reflection saved after feedback.
 */
import { prisma } from "@/lib/db";

// ---- Immediate scoring (RETRIEVAL / INTERLEAVED / ERROR_REPAIR) ----

/** The answer a student committed to see a free-recall model answer, if any. */
export function committedAnswerOf(meta: unknown): string | null {
  const value = (meta as { committed_answer?: unknown } | null | undefined)?.committed_answer;
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

// ---- Answer standard reveal ----

export type RevealGate =
  | { kind: "reveal"; commit: string | null }
  | { kind: "withhold" }
  | { kind: "wrong_phase" }
  | { kind: "wrong_index"; expected: number }
  | { kind: "answer_required" };

/**
 * Whether the model answer for a question may be shown. Pure, so the rule
 * is unit-tested on its own:
 * - never during the EXAM phase of an exam simulation;
 * - only for the run's current question;
 * - an answered question (attempt recorded) always reveals;
 * - an unanswered MCQ never reveals: the model answer names the right
 *   choice and MCQ grading happens on the server;
 * - an unanswered free-recall question reveals only against a committed
 *   answer: either one sent now (`commit` records it, first answer wins) or
 *   one committed earlier. Without one, the answer stays hidden, so no
 *   prefetch or stray request can leak it before the student answers.
 */
export function revealGate(input: {
  phase: string;
  currentIndex: number;
  index: number;
  isMcq: boolean;
  answered: boolean;
  committedAnswer: string | null;
  userAnswer?: string | null;
}): RevealGate {
  if (input.phase === "EXAM") return { kind: "wrong_phase" };
  if (input.index !== input.currentIndex) return { kind: "wrong_index", expected: input.currentIndex };
  if (input.answered) return { kind: "reveal", commit: null };
  if (input.isMcq) return { kind: "withhold" };
  if (input.committedAnswer) return { kind: "reveal", commit: null };
  const answer = input.userAnswer?.trim();
  if (answer) return { kind: "reveal", commit: answer };
  return { kind: "answer_required" };
}

/**
 * Reveal the model answer and points to check for the CURRENT question so
 * the student self-scores against an explicit standard instead of a
 * feeling (calibration: self-assessment without a reference answer is
 * unreliable).
 *
 * Free recall is scored after the reveal, so the attempt does not exist yet
 * when the model answer is shown. The student's answer therefore travels
 * with the request (`userAnswer`) and is committed on the question: the
 * first committed answer is the one later recorded with the score, and it
 * comes back as `committed_answer`. Without an answer or an attempt the
 * model answer is never returned (see revealGate). Withheld during the EXAM
 * phase of EXAM_SIM. For repair questions the expected correction rule
 * serves as the standard.
 */
export async function getAnswerReveal(
  userId: string,
  runId: string,
  index: number,
  options: { userAnswer?: string | null } = {},
) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: { userId: true, currentIndex: true, phase: true, status: true, promptCount: true },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const [row, attempt] = await Promise.all([
    prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: index } },
    }),
    prisma.sessionAttempt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: index } },
      select: { id: true, userAnswer: true },
    }),
  ]);
  const meta = (row?.meta ?? null) as {
    format?: string;
    model_answer?: string;
    key_points?: string[];
    expected_correction_rule?: string;
    committed_answer?: string;
  } | null;
  const committed = committedAnswerOf(meta);

  const gate = revealGate({
    phase: run.phase,
    currentIndex: run.currentIndex,
    index,
    isMcq: meta?.format === "MCQ",
    answered: attempt !== null,
    committedAnswer: committed,
    userAnswer: options.userAnswer,
  });

  switch (gate.kind) {
    case "wrong_phase":
      return { error: "wrong_phase" as const, message: "Model answers appear after the last question of an exam simulation." };
    case "wrong_index":
      return { error: "wrong_index" as const, expected: gate.expected };
    case "answer_required":
      return { error: "answer_required" as const };
    case "withhold":
      return { data: { model_answer: null, key_points: null, committed_answer: null } };
  }

  if (gate.commit && row) {
    await prisma.sessionRunPrompt.update({
      where: { id: row.id },
      data: {
        meta: {
          ...((row.meta as Record<string, unknown> | null) ?? {}),
          committed_answer: gate.commit,
          committed_at: new Date().toISOString(),
        } as object,
      },
    });
  }

  return {
    data: {
      model_answer: meta?.model_answer ?? meta?.expected_correction_rule ?? null,
      key_points: Array.isArray(meta?.key_points) ? meta.key_points : null,
      committed_answer: attempt?.userAnswer ?? committed ?? gate.commit,
    },
  };
}

// ---- Post-review metacognition update ----

/**
 * Attach a self-explanation / generated example to an already-submitted
 * attempt. The review panel collects these AFTER the attempt is recorded;
 * they must never be posted as a new attempt (that would fabricate a scored
 * attempt against the next, unseen prompt).
 */
export async function updateAttemptMeta(
  userId: string,
  attemptId: string,
  input: { self_explanation?: string; generated_example?: string; socratic_answer?: string },
) {
  const attempt = await prisma.sessionAttempt.findUnique({
    where: { id: attemptId },
    select: { id: true, run: { select: { userId: true } } },
  });
  if (!attempt) return { error: "not_found" as const };
  if (attempt.run.userId !== userId) return { error: "forbidden" as const };

  await prisma.sessionAttempt.update({
    where: { id: attemptId },
    data: {
      selfExplanation: input.self_explanation ?? undefined,
      generatedExample: input.generated_example ?? undefined,
      socraticAnswer: input.socratic_answer ?? undefined,
    },
  });

  return { data: { ok: true } };
}
