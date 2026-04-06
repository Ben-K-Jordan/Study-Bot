/**
 * Research-informed plan generator.
 *
 * When a real AI provider is configured, queries the research knowledge base
 * for relevant evidence cards and uses an LLM to design an optimal study
 * schedule grounded in learning science. Falls back to the deterministic
 * template when AI is unavailable or returns null blocks.
 */
import { SessionMode } from "./validation";
import { generatePlan, PlanBlock } from "./plan-generator";
import { buildResearchContext } from "@/services/research";
import { runTask, GatewayError } from "./ai/gateway";
import type { GatewayContext } from "./ai/gateway";
import { AiTask } from "./ai/types";
import { getPrompt } from "./ai/prompt-registry";
import { logger } from "./logger";

export interface StudyPreferences {
  chronotype: "morning" | "evening" | "flexible";
  preferredSessionMinutes: number;
  studyStyle: "intensive" | "balanced" | "relaxed";
}

interface ResearchPlanInput {
  objectives: string[];
  dailyCap: number;
  breakProtocol: string;
  availability: { start: string; end: string }[];
  examDate: string;
  preferences?: StudyPreferences;
  contentContext?: string;
}

interface AiPlanBlock {
  dayIndex: number;
  mode: string;
  objectives: string[];
  plannedMinutes: number;
  outcomeType: string | null;
  targetAccuracy: number;
  closedBookRequired: boolean;
}

interface AiPlanOutput {
  blocks: AiPlanBlock[] | null;
  reasoning: string;
}

const VALID_MODES = new Set<string>([
  "RETRIEVAL",
  "INTERLEAVED_PRACTICE",
  "ERROR_REPAIR",
  "EXAM_SIM",
  "WORKED_EXAMPLES",
]);

function availableMinutes(avail: { start: string; end: string }): number {
  const [sh, sm] = avail.start.split(":").map(Number);
  const [eh, em] = avail.end.split(":").map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function toObjectiveEntries(strs: string[]): { id: string; title: string }[] {
  return strs.map((s, i) => ({ id: `obj_${i}`, title: s }));
}

/**
 * Convert AI-generated blocks into PlanBlock format with validation and clamping.
 */
function convertAiBlocks(
  aiBlocks: AiPlanBlock[],
  allObjectives: string[],
  dailyCap: number,
  availability: { start: string; end: string }[],
): PlanBlock[] {
  const dayRemaining: Record<number, number> = {};

  const results: PlanBlock[] = [];

  for (const b of aiBlocks) {
    // Validate mode
    if (!VALID_MODES.has(b.mode)) continue;
    // Validate dayIndex within availability range
    if (b.dayIndex < 0 || b.dayIndex >= availability.length) continue;

    // Initialize day remaining if needed
    if (dayRemaining[b.dayIndex] === undefined) {
      dayRemaining[b.dayIndex] = Math.min(dailyCap, availableMinutes(availability[b.dayIndex]));
    }

    // Clamp duration
    const remaining = dayRemaining[b.dayIndex];
    const minutes = Math.max(15, Math.min(b.plannedMinutes, remaining));
    dayRemaining[b.dayIndex] -= minutes;

    if (minutes < 15) continue;

    // Filter objectives to only those in the original list
    const validObjs = b.objectives.filter((o) => allObjectives.includes(o));
    const objs = validObjs.length > 0 ? validObjs : allObjectives.slice(0, 5);

    results.push({
      dayIndex: b.dayIndex,
      mode: b.mode as SessionMode,
      topicScope: objs.join(", "),
      objectives: toObjectiveEntries(objs),
      plannedMinutes: minutes,
      targetOutcome: {
        type: b.outcomeType ?? undefined,
        prompt_count: Math.max(5, Math.round(minutes / 4)),
        target_accuracy: b.targetAccuracy ?? (b.mode === "EXAM_SIM" ? 0.7 : 0.8),
        closed_book_required: b.closedBookRequired ?? (b.mode === "RETRIEVAL" || b.mode === "EXAM_SIM"),
      },
    });
  }

  return results;
}

/**
 * Generate a study plan using research evidence + AI when available.
 * Falls back to the deterministic template on any failure.
 */
export async function generatePlanWithResearch(
  input: ResearchPlanInput,
  gatewayCtx: GatewayContext | null,
): Promise<{ blocks: PlanBlock[]; aiGenerated: boolean; reasoning?: string }> {
  // If no gateway context (no AI configured), use deterministic fallback
  if (!gatewayCtx) {
    return {
      blocks: generatePlan(input),
      aiGenerated: false,
    };
  }

  try {
    // Gather research evidence on scheduling-relevant topics
    const researchContext = await buildResearchContext([
      "spacing",
      "scheduling",
      "retrieval-practice",
      "interleaving",
      "session-duration",
      "breaks",
      "difficulty",
      "exam-simulation",
      "pretesting",
      "diagnostic",
      "time-of-day",
      "successive-relearning",
    ]);

    const numDays = input.availability.length;
    const availabilityByDay = input.availability.map((a, i) => ({
      dayIndex: i,
      windowMinutes: availableMinutes(a),
    }));

    const prompt = getPrompt(AiTask.GENERATE_STUDY_PLAN);

    const result = await runTask<AiPlanOutput>(gatewayCtx, {
      task: AiTask.GENERATE_STUDY_PLAN,
      model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
      promptVersion: prompt.version,
      input: {
        objectives: input.objectives,
        numDays,
        dailyCapMinutes: input.dailyCap,
        availabilityByDay,
        researchContext,
        examDate: input.examDate,
        preferences: input.preferences,
        contentContext: input.contentContext,
      },
      parseOutput: (raw: unknown) => {
        const data = raw as Record<string, unknown>;
        return {
          blocks: data.blocks as AiPlanBlock[] | null,
          reasoning: (data.reasoning as string) || "",
        };
      },
    });

    // If AI returned null blocks (e.g. mock provider), fall back
    if (!result.output.blocks || result.output.blocks.length === 0) {
      return {
        blocks: generatePlan(input),
        aiGenerated: false,
        reasoning: result.output.reasoning,
      };
    }

    // Convert and validate AI blocks
    const blocks = convertAiBlocks(
      result.output.blocks,
      input.objectives,
      input.dailyCap,
      input.availability,
    );

    // Sanity check: AI must produce at least 3 blocks
    if (blocks.length < 3) {
      logger.warn("research_plan.too_few_blocks", {
        ai_blocks: result.output.blocks.length,
        valid_blocks: blocks.length,
      });
      return {
        blocks: generatePlan(input),
        aiGenerated: false,
        reasoning: "AI produced too few valid blocks — using deterministic fallback.",
      };
    }

    logger.info("research_plan.ai_generated", {
      blocks: blocks.length,
      reasoning: result.output.reasoning.slice(0, 200),
    });

    return {
      blocks,
      aiGenerated: true,
      reasoning: result.output.reasoning,
    };
  } catch (err) {
    // On any AI failure, fall back silently to deterministic plan
    const message = err instanceof GatewayError ? err.code : String(err);
    logger.warn("research_plan.ai_fallback", { error: message });

    return {
      blocks: generatePlan(input),
      aiGenerated: false,
      reasoning: `AI unavailable (${message}) — using deterministic fallback.`,
    };
  }
}
