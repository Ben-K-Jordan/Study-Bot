/**
 * Question views for the client: answer keys withheld until exam scoring,
 * GET /prompt with adaptive difficulty, and the deck redaction.
 */
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { Prompt } from "@/lib/prompts";
import type { PromptView, RunMetrics } from "./shared";

/**
 * Convert a generated Prompt to a PromptView for API responses.
 *
 * The answer key (correctIndex, distractorRationales) is withheld unless
 * includeAnswer is true — it is only exposed during EXAM_SIM REVIEW, after
 * all answers are locked in. Immediate-scoring modes grade MCQ selections
 * server-side, so the client never needs the key before answering.
 */
export function toPromptView(prompt: Prompt, index: number, includeAnswer = false): PromptView {
  const view: PromptView = {
    prompt_index: index,
    text: prompt.text,
    objective_id: prompt.objective_id,
    difficulty: prompt.difficulty,
  };
  if (prompt.format === "MCQ" && prompt.choices) {
    view.format = "MCQ";
    view.choices = prompt.choices;
    if (includeAnswer && prompt.correctIndex != null) {
      view.correctIndex = prompt.correctIndex;
      if (prompt.meta?.distractorRationales) {
        view.meta = { distractorRationales: prompt.meta.distractorRationales };
      }
    }
  }
  // Error-repair context (not an answer key) — lets the UI show which
  // question the repair prompt refers to.
  if (prompt.meta?.original_prompt_text) {
    view.meta = { ...(view.meta ?? {}), original_prompt_text: prompt.meta.original_prompt_text };
  }
  // Pack marker (PRE_TEST etc.) drives client framing; not sensitive.
  if (prompt.meta?.pack) {
    view.meta = { ...(view.meta ?? {}), pack: prompt.meta.pack };
  }
  if (typeof prompt.meta?.step_count === "number") {
    view.meta = { ...(view.meta ?? {}), step_count: prompt.meta.step_count };
  }
  return view;
}

/**
 * PromptView for a normalized SessionRunPrompt row. The MCQ answer key is
 * withheld unless `includeAnswer` (EXAM_SIM REVIEW only); framing fields
 * (pack, original question, worked-example step count) always pass through.
 */
export function rowToPromptView(
  row: { promptIndex: number; text: string; objectiveId: string | null; difficulty: number; sourceType: string; meta: unknown },
  index: number,
  includeAnswer: boolean,
): PromptView {
  const meta = row.meta as Record<string, unknown> | null;
  const view: PromptView = {
    prompt_index: index,
    text: row.text,
    objective_id: row.objectiveId ?? undefined,
    difficulty: row.difficulty,
    source_type: row.sourceType,
  };
  if (meta?.format === "MCQ" && Array.isArray(meta.choices)) {
    view.format = "MCQ";
    view.choices = meta.choices as string[];
    if (includeAnswer && meta.correctIndex != null) {
      view.correctIndex = meta.correctIndex as number;
      if (Array.isArray(meta.distractorRationales)) {
        view.meta = { distractorRationales: meta.distractorRationales as string[] };
      }
    }
  }
  if (typeof meta?.original_prompt_text === "string") {
    view.meta = { ...(view.meta ?? {}), original_prompt_text: meta.original_prompt_text };
  }
  if (typeof meta?.pack === "string") {
    view.meta = { ...(view.meta ?? {}), pack: meta.pack };
  }
  if (typeof meta?.step_count === "number") {
    view.meta = { ...(view.meta ?? {}), step_count: meta.step_count };
  }
  return view;
}

/**
 * Redact answer keys from a raw prompts array before returning it to the
 * client (run start/resume and GET /runs/:id responses include the full
 * deck; without redaction that response is a one-click answer key).
 */
export function redactPrompts(prompts: Prompt[]): Prompt[] {
  return prompts.map((p) => {
    const { correctIndex: _ci, ...rest } = p;
    let meta = p.meta;
    if (meta) {
      const {
        distractorRationales: _dr,
        expected_correction_rule: _ecr,
        model_answer: _ma,
        key_points: _kp,
        ...metaRest
      } = meta;
      meta = Object.keys(metaRest).length > 0 ? metaRest : undefined;
    }
    return { ...rest, meta } as Prompt;
  });
}

// ---- Get Prompt by Index ----

export async function getPromptAt(
  runId: string,
  index: number,
  fallbackPrompts: Prompt[],
  includeAnswer = false,
): Promise<PromptView> {
  const row = await prisma.sessionRunPrompt.findUnique({
    where: { runId_promptIndex: { runId, promptIndex: index } },
  });
  if (row) {
    // MCQ answer key withheld unless explicitly requested (EXAM_SIM REVIEW).
    return rowToPromptView(row, row.promptIndex, includeAnswer);
  }
  // Fallback to JSONB for runs created before migration
  const p = fallbackPrompts[index];
  if (!p) return { prompt_index: index, text: "" };
  return toPromptView(p, index, includeAnswer);
}

export async function getRunPrompt(userId: string, runId: string, index: number) {
  const run = await prisma.sessionRun.findUnique({
    where: { runId },
    select: { userId: true, promptCount: true, prompts: true, metrics: true, mode: true, phase: true, status: true, currentIndex: true },
  });
  if (!run) return { error: "not_found" as const };
  if (run.userId !== userId) return { error: "forbidden" as const };

  const count = run.promptCount || (run.prompts as unknown as Prompt[]).length;
  if (index < 0 || index >= count) return { error: "invalid_index" as const };

  // MCQ answer keys are only revealed during EXAM_SIM REVIEW, after all
  // answers are locked in.
  const includeAnswer = run.phase === "REVIEW";

  // Adaptive difficulty: reorder remaining prompts based on running accuracy.
  // Only on an ACTIVE run's CURRENT prompt — GET must otherwise stay a pure
  // read (a stale tab fetching an answered index must never reorder the deck).
  const metrics = run.metrics as unknown as RunMetrics;
  if (
    run.mode !== "EXAM_SIM" &&
    run.status === "ACTIVE" &&
    run.phase === "ACTIVE" &&
    index === run.currentIndex &&
    metrics.attempts_count >= 2 &&
    index > 0
  ) {
    const adapted = await adaptPromptDifficulty(runId, index, count, metrics.accuracy);
    if (adapted) return { data: adapted };
  }

  const prompt = await getPromptAt(runId, index, run.prompts as unknown as Prompt[], includeAnswer);
  return { data: prompt };
}

/**
 * Adaptive difficulty: select the best-fit prompt from remaining prompts
 * based on the student's running accuracy.
 *
 * - accuracy >= 0.8 → prefer harder prompts (difficulty 4-5)
 * - accuracy >= 0.5 → prefer medium prompts (difficulty 2-3)
 * - accuracy < 0.5  → prefer easier prompts (difficulty 1-2)
 *
 * Returns null if the current prompt is already at the right difficulty,
 * or if no better-fit prompt exists.
 */
async function adaptPromptDifficulty(
  runId: string,
  currentIndex: number,
  totalCount: number,
  accuracy: number,
): Promise<PromptView | null> {
  // Determine target difficulty range
  let targetMin: number, targetMax: number;
  if (accuracy >= 0.8) {
    targetMin = 4; targetMax = 5;
  } else if (accuracy >= 0.5) {
    targetMin = 2; targetMax = 4;
  } else {
    targetMin = 1; targetMax = 2;
  }

  // Get current prompt, previous prompt (for interleaving adjacency), and
  // remaining prompts
  const [currentPrompt, previousPrompt, remainingPrompts] = await Promise.all([
    prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex } },
    }),
    prisma.sessionRunPrompt.findUnique({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex - 1 } },
    }),
    prisma.sessionRunPrompt.findMany({
      where: {
        runId,
        promptIndex: { gt: currentIndex, lt: totalCount },
      },
      orderBy: { promptIndex: "asc" },
    }),
  ]);

  if (!currentPrompt || remainingPrompts.length === 0) return null;

  // If current prompt is already in target range, keep it
  if (currentPrompt.difficulty >= targetMin && currentPrompt.difficulty <= targetMax) {
    return null;
  }

  // Find better-fit prompts among remaining prompts; prefer one whose
  // objective differs from the previous prompt so a difficulty swap never
  // silently un-interleaves the deck (Rohrer & Taylor 2007).
  const candidates = remainingPrompts.filter(
    (p) => p.difficulty >= targetMin && p.difficulty <= targetMax
  );
  const betterFit =
    candidates.find((p) => p.objectiveId !== previousPrompt?.objectiveId) ??
    candidates[0];

  if (!betterFit) return null;

  // Swap the two rows inside a transaction, parking the current row at a
  // temporary out-of-range index first. A single-statement CASE swap would
  // violate the non-deferrable unique index on (run_id, prompt_index) —
  // PostgreSQL enforces unique indexes per-row during UPDATE.
  const swapIdx = betterFit.promptIndex;
  await prisma.$transaction([
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: currentIndex } },
      data: { promptIndex: -1 },
    }),
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: swapIdx } },
      data: { promptIndex: currentIndex },
    }),
    prisma.sessionRunPrompt.update({
      where: { runId_promptIndex: { runId, promptIndex: -1 } },
      data: { promptIndex: swapIdx },
    }),
  ]);

  logger.info("adaptive.swapped", {
    run_id: runId,
    index: currentIndex,
    old_difficulty: currentPrompt.difficulty,
    new_difficulty: betterFit.difficulty,
    accuracy,
    target_range: `${targetMin}-${targetMax}`,
  });

  // Answer key deliberately omitted: this view is served pre-answer. The
  // framing fields (pack, original question) travel with the swapped row so
  // a moved pretest still reads as a pretest.
  return rowToPromptView(betterFit, currentIndex, false);
}
