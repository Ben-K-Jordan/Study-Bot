/**
 * In-session variant question generator.
 *
 * When a student answers incorrectly, generates a variant question on the
 * same concept to be injected into the current session's prompt deck.
 *
 * Research basis (Kornell & Bjork 2008): Immediate re-testing after errors,
 * especially with varied question formats, produces 2-3x better retention
 * than simply showing the correct answer. The variant should test the same
 * concept from a different angle to force genuine retrieval, not pattern
 * matching.
 *
 * Variant prompts are appended to the end of the deck (not inserted next)
 * to provide 1-3 intervening items of natural spacing, which further
 * enhances the retrieval difficulty and learning effect.
 */

import type { Prompt } from "@/lib/prompts";

/**
 * Variant question templates — each approaches the concept differently.
 * The original question text and error context are used to ground the variant.
 */
const VARIANT_TEMPLATES = [
  // Explain why the wrong answer is wrong
  (original: string, errorType: string) =>
    `Retry (different angle): A student answered a question about this topic incorrectly due to a ${errorType.toLowerCase()} error. The original question was: "${original}"\n\nNow explain: What is the correct concept, and why does the common mistake happen?`,

  // Apply the concept to a new scenario
  (original: string, _errorType: string) =>
    `Apply it: You previously studied this topic. Here's a new scenario — apply the same underlying concept:\n\nOriginal: "${original}"\n\nDescribe how you would apply this concept to a different but related situation. Give a concrete example.`,

  // Compare and contrast
  (original: string, errorType: string) =>
    `Distinguish: A ${errorType.toLowerCase()} error often happens because two concepts are confused. Referring to: "${original}"\n\nIdentify the two concepts that could be confused here and explain the key difference between them.`,

  // Teach it back
  (original: string, _errorType: string) =>
    `Teach it: Imagine you need to explain this concept to a classmate who is confused. The topic: "${original}"\n\nWrite a clear, simple explanation in your own words. Include one example that makes it click.`,
] as const;

/**
 * Generate a variant question from error context.
 * Returns a Prompt ready to be appended to the run's prompt deck.
 *
 * @param promptIndex - The index this new prompt will occupy in the deck
 * @param originalPromptText - The question the student got wrong
 * @param errorType - Classification of the error (MISCONCEPTION, PROCEDURE, etc.)
 * @param correctionRule - Student's self-identified correction rule
 * @param objectiveId - The objective this question tests (preserved for mastery tracking)
 * @param errorLogId - The error log entry that triggered this variant
 */
export function generateVariantQuestion(
  promptIndex: number,
  originalPromptText: string,
  errorType: string,
  correctionRule: string,
  objectiveId?: string,
  errorLogId?: string,
): Prompt {
  // Select template based on error type for maximum learning impact
  let templateIdx: number;
  switch (errorType) {
    case "MISCONCEPTION":
      templateIdx = 2; // Compare/contrast — directly addresses confused concepts
      break;
    case "PROCEDURE":
      templateIdx = 1; // Apply — practice the correct procedure in a new context
      break;
    case "CARELESS":
      templateIdx = 3; // Teach — forces careful articulation
      break;
    case "MEMORY":
    default:
      templateIdx = 0; // Explain why — rebuilds the memory trace
      break;
  }

  const templateFn = VARIANT_TEMPLATES[templateIdx];
  const text = templateFn(originalPromptText, errorType);

  return {
    id: `variant_${promptIndex}`,
    objective_id: objectiveId,
    text,
    difficulty: 2, // Variant questions are moderate difficulty — they're re-testing, not introducing new material
    meta: {
      pack: "VARIANT_REPAIR",
      source_error_log_id: errorLogId,
      original_prompt_text: originalPromptText,
      expected_correction_rule: correctionRule,
    },
  };
}

/**
 * Maximum variant questions to inject per session.
 * Caps at 4 to prevent the session from becoming too long.
 * Research shows diminishing returns beyond 3-4 retry items per session
 * (Rawson & Dunlosky 2011).
 */
export const MAX_VARIANTS_PER_SESSION = 4;
