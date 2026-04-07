/**
 * Content-aware prompt generator.
 *
 * Fetches relevant course material chunks and uses the AI to generate
 * study questions grounded in actual course content — making the experience
 * feel like studying with a professor who knows the material.
 *
 * Falls back to deterministic template prompts when:
 * - No content is available for the course
 * - AI provider is not configured (mock mode)
 * - AI call fails for any reason
 */
import { getContentContextForSession } from "@/services/content-plan";
import { runTask } from "@/lib/ai/gateway";
import type { GatewayContext } from "@/lib/ai/gateway";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { logger } from "@/lib/logger";
import type { Prompt } from "@/lib/prompts";

interface ContentPromptParams {
  userId: string;
  courseName: string;
  examName?: string;
  mode: string;
  topicScope: string;
  objectives: { id: string; title: string }[];
  promptCount: number;
  gatewayCtx: GatewayContext | null;
}

interface GeneratedPrompt {
  objective_id: string;
  text: string;
  difficulty: number;
}

/**
 * Generate study prompts grounded in the user's uploaded course content.
 * Returns null if no content is available or AI generation fails,
 * signaling the caller to fall back to deterministic prompts.
 */
export async function generateContentAwarePrompts(
  params: ContentPromptParams,
): Promise<Prompt[] | null> {
  const { userId, courseName, examName, mode, topicScope, objectives, promptCount, gatewayCtx } = params;

  // Need AI provider to generate content-aware prompts
  if (!gatewayCtx) return null;

  // Fetch relevant content chunks for the session's objectives
  const content = await getContentContextForSession(
    userId,
    courseName,
    mode,
    objectives.map((o) => o.title),
    15, // fetch up to 15 relevant chunks
  );

  // Not enough content to generate meaningful questions
  if (content.snippets.length < 2) {
    logger.info("content_prompts.insufficient_content", {
      user_id: userId,
      course_name: courseName,
      snippet_count: content.snippets.length,
    });
    return null;
  }

  const prompt = getPrompt(AiTask.GENERATE_PROMPTS);

  try {
    const result = await runTask<{ prompts: GeneratedPrompt[] }>(gatewayCtx, {
      task: AiTask.GENERATE_PROMPTS,
      model: process.env.AI_MODEL_ANSWER || "gpt-4o-mini",
      promptVersion: prompt.version,
      input: {
        mode,
        objectives,
        topicScope,
        promptCount,
        contentChunks: content.snippets.map((s) => ({
          doc_title: s.doc_title,
          page_number: s.page_number,
          text: s.text,
        })),
        courseName,
        examName,
      },
      parseOutput: (raw: unknown) => {
        const data = raw as Record<string, unknown>;
        const prompts = (data.prompts as GeneratedPrompt[]) || [];
        return { prompts };
      },
    });

    const generated = result.output.prompts;
    if (generated.length === 0) {
      logger.warn("content_prompts.empty_result", { user_id: userId });
      return null;
    }

    // Map to Prompt format with sequential IDs
    const mapped: Prompt[] = generated.map((g, i) => ({
      id: `p_${i}`,
      objective_id: g.objective_id,
      text: g.text,
      difficulty: Math.max(1, Math.min(5, g.difficulty || 1)),
    }));

    logger.info("content_prompts.generated", {
      user_id: userId,
      course_name: courseName,
      mode,
      count: mapped.length,
      content_chunks_used: content.snippets.length,
    });

    return mapped;
  } catch (err) {
    logger.error("content_prompts.generation_failed", {
      user_id: userId,
      course_name: courseName,
      error: String(err),
    });
    return null;
  }
}
