/**
 * Prompt deck generators for all session modes.
 *
 * Each generator is a pure function that produces a deterministic deck
 * from session data. Decks are generated once at run start and persisted
 * in session_runs.prompts — no DB randomness needed at runtime.
 */

export type PromptFormat = "FREE_RECALL" | "MCQ";

export interface Prompt {
  id: string;
  objective_id?: string;
  text: string;
  difficulty: number;
  format?: PromptFormat;
  /** 4 answer choices (already shuffled). Present only when format = "MCQ". */
  choices?: string[];
  /** Index of the correct answer within choices. Present only when format = "MCQ". */
  correctIndex?: number;
  meta?: {
    pack?: string;
    source_error_log_id?: string;
    original_prompt_text?: string;
    expected_correction_rule?: string;
    variant_question?: string;
    /** Why each distractor is plausible — aids post-answer feedback. */
    distractorRationales?: string[];
  };
}

interface Objective {
  id: string;
  title: string;
}

// ---- Shared helpers ----

const RETRIEVAL_VARIANTS = [
  (title: string) => `From memory: explain ${title} in 3–5 bullets.`,
  (title: string) => `Define ${title} and give one concrete example.`,
  (title: string) => `List the key steps involved in ${title}.`,
  (title: string) => `What are the most common pitfalls when applying ${title}?`,
  (title: string) => `Outline how you would explain ${title} to a classmate.`,
  (title: string) => `Compare and contrast two aspects of ${title}.`,
] as const;

function resolveObjectives(
  objectives?: Objective[] | null,
  topicScope?: string
): Objective[] {
  if (objectives?.length) return objectives;
  return [{ id: "topic_0", title: topicScope ?? "General" }];
}

function resolvePromptCount(
  targetOutcome?: { prompt_count?: number } | null,
  fallback = 10
): number {
  return targetOutcome?.prompt_count ?? fallback;
}

// ---- RETRIEVAL ----

export function generateRetrievalPrompts(session: {
  objectives?: Objective[] | null;
  target_outcome?: { prompt_count?: number } | null;
  topic_scope: string;
}): Prompt[] {
  const count = resolvePromptCount(session.target_outcome);
  const objectives = resolveObjectives(session.objectives, session.topic_scope);
  const prompts: Prompt[] = [];

  for (let i = 0; i < count; i++) {
    const obj = objectives[i % objectives.length];
    const variantFn = RETRIEVAL_VARIANTS[i % RETRIEVAL_VARIANTS.length];
    prompts.push({
      id: `p_${i}`,
      objective_id: obj.id,
      text: variantFn(obj.title),
      difficulty: 1,
    });
  }

  return prompts;
}

// ---- INTERLEAVED_PRACTICE ----

/**
 * Generates an interleaved deck where consecutive prompts differ by
 * objective_id as much as possible.
 *
 * Algorithm:
 * 1. Generate K prompts per objective (K = ceil(count / numObjectives))
 * 2. Use seeded deterministic shuffle within each objective's list
 * 3. Interleave round-robin: take 1 from each objective list in rotation
 * 4. Trim to target count
 *
 * Guarantees: no more than 2 consecutive prompts with the same objective_id
 * when there are 2+ objectives.
 */
export function generateInterleavedPrompts(session: {
  objectives?: Objective[] | null;
  target_outcome?: { prompt_count?: number } | null;
  topic_scope: string;
  seed?: string;
}): Prompt[] {
  const count = resolvePromptCount(session.target_outcome);
  const objectives = resolveObjectives(session.objectives, session.topic_scope);

  if (objectives.length === 1) {
    // Fall back to retrieval-style when only one objective
    return generateRetrievalPrompts(session);
  }

  // Build per-objective prompt lists
  const perObj = Math.ceil(count / objectives.length);
  const buckets: Prompt[][] = objectives.map((obj, objIdx) => {
    const list: Prompt[] = [];
    for (let k = 0; k < perObj; k++) {
      const globalIdx = objIdx * perObj + k;
      const variantFn = RETRIEVAL_VARIANTS[globalIdx % RETRIEVAL_VARIANTS.length];
      list.push({
        id: `p_${globalIdx}`,
        objective_id: obj.id,
        text: variantFn(obj.title),
        difficulty: 1,
        meta: { pack: `obj_${objIdx}` },
      });
    }
    return list;
  });

  // Deterministic shuffle each bucket using seed
  const seed = session.seed ?? "default";
  for (const bucket of buckets) {
    deterministicShuffle(bucket, seed);
  }

  // Interleave round-robin
  const result: Prompt[] = [];
  const pointers = new Array(buckets.length).fill(0);
  let exhausted = 0;

  while (result.length < count && exhausted < buckets.length) {
    exhausted = 0;
    for (let b = 0; b < buckets.length && result.length < count; b++) {
      if (pointers[b] < buckets[b].length) {
        result.push(buckets[b][pointers[b]]);
        pointers[b]++;
      } else {
        exhausted++;
      }
    }
  }

  // Re-assign sequential IDs for cleanliness
  for (let i = 0; i < result.length; i++) {
    result[i] = { ...result[i], id: `p_${i}` };
  }

  return result;
}

/**
 * Deterministic in-place shuffle using a simple seed-based PRNG.
 * Fisher-Yates with a seeded hash. Not cryptographic, but deterministic.
 */
export function deterministicShuffle<T>(arr: T[], seed: string): void {
  let h = simpleHash(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    h = (h * 1664525 + 1013904223) >>> 0;
    const j = h % (i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) >>> 0;
  }
  return h || 1;
}

// ---- MCQ choice shuffling ----

/**
 * Shuffle MCQ choices deterministically so the correct answer doesn't always
 * land in the same position. Uses a per-prompt seed (prompt ID + run-level seed)
 * so the order is stable across page refreshes but varies across prompts.
 *
 * Returns a new Prompt with shuffled choices and updated correctIndex.
 */
export function shuffleMcqChoices(prompt: Prompt, runSeed: string): Prompt {
  if (prompt.format !== "MCQ" || !prompt.choices || prompt.correctIndex == null) {
    return prompt;
  }

  // An out-of-range correctIndex would become -1 after shuffling (indexOf
  // miss), making the question unanswerable — refuse to shuffle instead.
  if (
    !Number.isInteger(prompt.correctIndex) ||
    prompt.correctIndex < 0 ||
    prompt.correctIndex >= prompt.choices.length
  ) {
    return prompt;
  }

  // Build index array [0, 1, 2, 3] and shuffle it
  const indices = prompt.choices.map((_, i) => i);
  const seed = `${runSeed}:${prompt.id}`;
  deterministicShuffle(indices, seed);

  const shuffledChoices = indices.map((i) => prompt.choices![i]);
  const newCorrectIndex = indices.indexOf(prompt.correctIndex);

  // Reorder distractor rationales to match new positions — only when they
  // align 1:1 with choices; a short array would misattribute rationales.
  let shuffledRationales: string[] | undefined;
  if (prompt.meta?.distractorRationales?.length === prompt.choices.length) {
    shuffledRationales = indices.map((i) => prompt.meta!.distractorRationales![i]);
  }

  return {
    ...prompt,
    choices: shuffledChoices,
    correctIndex: newCorrectIndex,
    meta: prompt.meta
      ? { ...prompt.meta, distractorRationales: shuffledRationales }
      : undefined,
  };
}

// ---- EXAM_SIM ----

/**
 * Generates an exam simulation deck. Same prompt generation as retrieval
 * but policies differ (delayed scoring). The deck itself is identical.
 */
export function generateExamSimPrompts(session: {
  objectives?: Objective[] | null;
  target_outcome?: { prompt_count?: number } | null;
  topic_scope: string;
}): Prompt[] {
  // Exam sim uses same prompt generation as retrieval
  return generateRetrievalPrompts(session);
}

// ---- ERROR_REPAIR ----

export interface ErrorLogForRepair {
  id: string;
  prompt_index: number;
  error_type: string;
  correction_rule: string;
  variant_question?: string | null;
  prompt_text?: string;
}

/**
 * Generates a repair deck from unresolved error logs.
 * Each error becomes a repair prompt that tests the correction rule
 * WITHOUT revealing it before the user answers.
 */
export function generateErrorRepairPrompts(
  errorLogs: ErrorLogForRepair[],
  targetCount: number
): Prompt[] {
  const selected = errorLogs.slice(0, targetCount);

  return selected.map((log, i) => {
    const variant = log.variant_question?.trim();
    // Without the original question in the text, every no-variant repair
    // prompt renders as the same generic sentence and the student cannot
    // tell which error is being repaired.
    const original = log.prompt_text?.trim();
    const text = variant
      ? `From memory: state the correct rule and answer the variant: ${variant}`
      : original
        ? `You previously missed: "${original}" — From memory: state the correct rule for this error and give a near-transfer example where this rule applies.`
        : `From memory: state the correct rule for this error and give a near-transfer example where this rule applies.`;

    return {
      id: `p_${i}`,
      objective_id: undefined,
      text,
      difficulty: 2,
      meta: {
        source_error_log_id: log.id,
        original_prompt_text: log.prompt_text,
        expected_correction_rule: log.correction_rule,
        variant_question: variant ?? undefined,
      },
    };
  });
}
