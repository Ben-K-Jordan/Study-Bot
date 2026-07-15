/**
 * Worked-example deck generator.
 *
 * Research basis:
 * - Worked-example effect (Sweller & Cooper 1985): novices learn more from
 *   studying worked solutions than from unsupported problem solving.
 * - Backward fading (Renkl et al. 2002): transition from full example to
 *   completion problems (last step missing, then last two) to a full problem.
 * - Self-explanation (Chi 1989): prompting learners to explain steps in their
 *   own words amplifies the effect.
 *
 * Each AI-generated example set is expanded into a fixed 4-prompt fade:
 *   1. STUDY   — full worked example + self-explanation question (difficulty 2)
 *   2. COMPLETION 1 — final step missing                          (difficulty 3)
 *   3. COMPLETION 2 — final two steps missing                     (difficulty 3)
 *   4. FULL    — solve the whole problem unaided                  (difficulty 4)
 *
 * Returns null when no AI gateway is configured, course content is
 * insufficient, or the model output is unusable — signaling the caller to
 * fall back to deterministic prompts.
 */
import { getContentContextForSession } from "@/services/content-plan";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { logger } from "@/lib/logger";
import type { Prompt } from "@/lib/prompts";

interface WorkedExampleDeckParams {
  userId: string;
  courseName: string;
  examName?: string;
  topicScope: string;
  objectives: { id: string; title: string }[];
  promptCount: number;
  gatewayCtx: GatewayContext | null;
}

interface WorkedExampleStep {
  action: string;
  why: string;
}

interface WorkedExampleSet {
  objective_id: string;
  problem: string;
  steps: WorkedExampleStep[];
  completion_problem_1: string;
  completion_problem_2: string;
  full_problem: string;
  model_answer: string;
}

/** Prompts emitted per worked-example set (study → fade 1 → fade 2 → full). */
const PROMPTS_PER_SET = 4;

/** Maximum example sets per session — each set already yields 4 prompts. */
const MAX_SETS = 3;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * A set is usable when it has a problem statement, at least 2 solution steps
 * (backward fading needs a penultimate step to remove), and a full problem.
 */
function isValidSet(set: WorkedExampleSet | null | undefined): set is WorkedExampleSet {
  return (
    !!set &&
    isNonEmptyString(set.problem) &&
    Array.isArray(set.steps) &&
    set.steps.length >= 2 &&
    isNonEmptyString(set.full_problem)
  );
}

function buildStudyText(set: WorkedExampleSet): string {
  const stepLines = set.steps.map(
    (s, i) => `Step ${i + 1}: ${s.action} — why: ${s.why}`,
  );
  return [
    set.problem,
    "",
    ...stepLines,
    "",
    `In your own words: why does step ${set.steps.length} follow from the previous steps?`,
  ].join("\n");
}

/**
 * Expand one worked-example set into its 4-prompt backward-fading sequence.
 * `startIndex` keeps prompt ids sequential (p_0, p_1, ...) across the deck.
 */
function buildSetPrompts(set: WorkedExampleSet, startIndex: number): Prompt[] {
  return [
    {
      id: `p_${startIndex}`,
      objective_id: set.objective_id,
      text: buildStudyText(set),
      difficulty: 2,
      format: "FREE_RECALL",
      meta: { pack: "WORKED_EXAMPLE" },
    },
    {
      id: `p_${startIndex + 1}`,
      objective_id: set.objective_id,
      text: `${set.completion_problem_1}\n(The final step is missing — supply it and state why it follows.)`,
      difficulty: 3,
      format: "FREE_RECALL",
      meta: { pack: "WE_COMPLETION_1" },
    },
    {
      id: `p_${startIndex + 2}`,
      objective_id: set.objective_id,
      text: `${set.completion_problem_2}\n(The final two steps are missing — supply them.)`,
      difficulty: 3,
      format: "FREE_RECALL",
      meta: { pack: "WE_COMPLETION_2" },
    },
    {
      id: `p_${startIndex + 3}`,
      objective_id: set.objective_id,
      text: set.full_problem,
      difficulty: 4,
      format: "FREE_RECALL",
      // model_answer stays server-side: the run API redacts it from client
      // payloads and reveals it only after the learner answers.
      meta: { pack: "WE_FULL", model_answer: set.model_answer },
    },
  ];
}

/**
 * Generate a worked-example deck grounded in the user's uploaded course
 * content. Returns null if no content is available or AI generation fails,
 * signaling the caller to fall back to deterministic prompts.
 */
export async function generateWorkedExampleDeck(
  params: WorkedExampleDeckParams,
): Promise<Prompt[] | null> {
  const { userId, courseName, examName, topicScope, objectives, promptCount, gatewayCtx } = params;

  // Need AI provider to generate worked examples
  if (!gatewayCtx) return null;

  // Fetch relevant content chunks for the session's objectives
  const content = await getContentContextForSession(
    userId,
    courseName,
    "WORKED_EXAMPLES",
    objectives.map((o) => o.title),
    15, // fetch up to 15 relevant chunks
  );

  // Not enough content to ground meaningful worked examples
  if (content.snippets.length < 2) {
    logger.info("worked_examples.insufficient_content", {
      user_id: userId,
      course_name: courseName,
      snippet_count: content.snippets.length,
    });
    return null;
  }

  // Each set fades into 4 prompts, so request ceil(promptCount / 4) sets,
  // clamped to [1, MAX_SETS].
  const setCount = Math.max(1, Math.min(MAX_SETS, Math.ceil(promptCount / PROMPTS_PER_SET)));

  const prompt = getPrompt(AiTask.GENERATE_WORKED_EXAMPLES);

  try {
    const result = await runTask<{ sets: WorkedExampleSet[] }>(gatewayCtx, {
      task: AiTask.GENERATE_WORKED_EXAMPLES,
      model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
      promptVersion: prompt.version,
      input: {
        courseName,
        examName,
        topicScope,
        objectives,
        contentChunks: content.snippets.map((s) => ({
          doc_title: s.doc_title,
          page_number: s.page_number,
          text: s.text,
        })),
        setCount,
      },
      parseOutput: (raw: unknown) => {
        const data = raw as Record<string, unknown>;
        const sets = (data.sets as WorkedExampleSet[]) || [];
        return { sets };
      },
    });

    const sets = result.output.sets;
    const validSets = sets.filter(isValidSet);

    if (validSets.length < sets.length) {
      logger.warn("worked_examples.invalid_sets_skipped", {
        user_id: userId,
        course_name: courseName,
        returned: sets.length,
        valid: validSets.length,
      });
    }

    if (validSets.length === 0) {
      logger.warn("worked_examples.no_valid_sets", {
        user_id: userId,
        course_name: courseName,
        returned: sets.length,
      });
      return null;
    }

    // Cap the deck at setCount sets (setCount * 4 prompts)
    const deck: Prompt[] = [];
    for (const set of validSets.slice(0, setCount)) {
      deck.push(...buildSetPrompts(set, deck.length));
    }

    logger.info("worked_examples.generated", {
      user_id: userId,
      course_name: courseName,
      set_count: validSets.length,
      prompt_count: deck.length,
      content_chunks_used: content.snippets.length,
    });

    return deck;
  } catch (err) {
    logger.error("worked_examples.generation_failed", {
      user_id: userId,
      course_name: courseName,
      error: String(err),
    });
    return null;
  }
}
