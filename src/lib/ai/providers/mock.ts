/**
 * Mock AI provider — deterministic outputs for tests.
 *
 * Embeddings: produces a stable vector from the text hash.
 * Completions: returns canned JSON responses keyed by task.
 */
import { createHash } from "crypto";
import type { AiProvider, EmbedResult, CompleteJsonResult } from "../provider";

const EMBED_DIM = 1536;

/**
 * Test-only escape hatch: when set (env var MOCK_AI_MALFORMED=1) or when the
 * user prompt carries the marker below (e.g. planted in topicScope/question
 * text by a test), the mock returns deliberately malformed variants for
 * GENERATE_PROMPTS / GENERATE_FEEDBACK / GENERATE_WORKED_EXAMPLES so the
 * output-hardening paths (drop/demote/fallback) can be exercised end-to-end.
 * Default behavior is unchanged.
 */
export const MALFORMED_MARKER = "__ELICIT_MALFORMED__";

function shouldElicitMalformed(userPrompt: string): boolean {
  return process.env.MOCK_AI_MALFORMED === "1" || userPrompt.includes(MALFORMED_MARKER);
}

/**
 * The first excerpt the user prompt lists ("(chunk_id: abc)"), so canned
 * answers cite an excerpt that was really retrieved and the demo shows its
 * sources. Falls back to a placeholder id when the prompt lists none.
 */
function firstChunkId(userPrompt: string): string {
  return /\(chunk_id: ([^)\s]+)\)/.exec(userPrompt)?.[1] ?? "mock_chunk_1";
}

/**
 * The guide's scope from the GENERATE_STUDY_GUIDE user prompt
 * ("Course: CS 2110 | Exam: Prelim 1"), so canned guide titles read like
 * real ones ("Cheat sheet for CS 2110 Prelim 1"). Null when absent.
 */
function guideScope(userPrompt: string): string | null {
  const match = /^Course: (.+?)(?: \| Exam: (.+))?$/m.exec(userPrompt);
  if (!match) return null;
  return [match[1], match[2]].filter(Boolean).join(" ").trim() || null;
}

function guideTitle(label: string, userPrompt: string): string {
  const scope = guideScope(userPrompt);
  return scope ? `${label} for ${scope}` : label;
}

/**
 * Generate a deterministic embedding vector from text.
 * Same text always produces the same vector. Different texts produce different vectors.
 */
function deterministicEmbedding(text: string, dim: number = EMBED_DIM): number[] {
  const hash = createHash("sha256").update(text).digest();
  const vec: number[] = [];
  for (let i = 0; i < dim; i++) {
    // Use hash bytes cyclically to seed deterministic floats
    const byte = hash[i % hash.length];
    vec.push((byte / 255) * 2 - 1); // Normalize to [-1, 1]
  }
  // L2 normalize
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  return vec.map((v) => v / norm);
}

export class MockProvider implements AiProvider {
  callLog: { method: string; args: unknown[] }[] = [];

  async embed(texts: string[], _model: string): Promise<EmbedResult> {
    this.callLog.push({ method: "embed", args: [texts, _model] });
    return {
      embeddings: texts.map((t) => deterministicEmbedding(t)),
      usage: { tokenIn: texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0) },
    };
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    _model: string,
  ): Promise<CompleteJsonResult> {
    this.callLog.push({ method: "completeJson", args: [systemPrompt, userPrompt, _model] });

    // Detect task from system prompt content and return appropriate mock
    if (systemPrompt.includes("ANSWER_WITH_CITATIONS")) {
      return {
        json: {
          answer_markdown: "Your materials define the core concept as the rule that governs how the main ideas interact [1].",
          citations: [
            { chunk_id: firstChunkId(userPrompt), reason: "Defines the concept", quote_snippet: "The concept is defined as…" },
          ],
        },
        usage: { tokenIn: 500, tokenOut: 150, costUsdMicros: 100 },
      };
    }

    if (systemPrompt.includes("GENERATE_VARIANT")) {
      return {
        json: { variant_question: "Can you explain this concept using a different example?" },
        usage: { tokenIn: 100, tokenOut: 30, costUsdMicros: 20 },
      };
    }

    if (systemPrompt.includes("SUGGEST_ERROR_TYPE")) {
      return {
        json: { error_type: "MISCONCEPTION", confidence: 0.8 },
        usage: { tokenIn: 100, tokenOut: 20, costUsdMicros: 15 },
      };
    }

    if (systemPrompt.includes("EXTRACT_OBJECTIVES")) {
      return {
        json: {
          objectives: [
            {
              title: "Core concepts",
              description: "The main principles and definitions in the course material.",
              difficulty: 1,
              keywords: ["fundamentals", "definitions", "core concepts"],
            },
            {
              title: "Applied problem solving",
              description: "Use the course methods to solve practical problems.",
              difficulty: 3,
              keywords: ["application", "problem solving", "practice"],
            },
            {
              title: "Critical analysis",
              description: "Judge a new scenario with the frameworks from the course.",
              difficulty: 4,
              keywords: ["analysis", "evaluation", "critical thinking"],
            },
            {
              title: "Synthesis across topics",
              description: "Connect ideas from different topics to explain one problem.",
              difficulty: 5,
              keywords: ["synthesis", "integration", "connections"],
            },
            {
              title: "Key terms",
              description: "The vocabulary and notation the course uses.",
              difficulty: 2,
              keywords: ["terminology", "vocabulary", "notation"],
            },
          ],
        },
        usage: { tokenIn: 800, tokenOut: 300, costUsdMicros: 150 },
      };
    }

    if (systemPrompt.includes("GENERATE_STUDY_PLAN")) {
      // Return null to signal "use deterministic fallback"
      return {
        json: { blocks: null, reasoning: "Mock provider: using the deterministic fallback." },
        usage: { tokenIn: 200, tokenOut: 50, costUsdMicros: 30 },
      };
    }

    if (systemPrompt.includes("SUMMARIZE_DOCUMENT")) {
      return {
        json: {
          summary: "This file defines the course's core concepts and shows how to apply them to practice problems.",
          suggested_questions: [
            "What are the main concepts in this file?",
            "How do these concepts relate to each other?",
            "What are the practical applications of these ideas?",
          ],
        },
        usage: { tokenIn: 400, tokenOut: 100, costUsdMicros: 75 },
      };
    }

    if (systemPrompt.includes("GENERATE_STUDY_GUIDE")) {
      // Detect guide type from user prompt (case-insensitive — prompt-registry lowercases the type)
      const promptLower = userPrompt.toLowerCase();
      if (promptLower.includes("faq")) {
        return {
          json: {
            guide_type: "FAQ",
            title: guideTitle("FAQ", userPrompt),
            sections: [
              { question: "What are the core concepts?", answer: "The principles and definitions the rest of the course material builds on." },
              { question: "How are these concepts applied?", answer: "These concepts are applied through problem-solving and analytical frameworks." },
            ],
          },
          usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
        };
      }
      if (promptLower.includes("cheat sheet") || promptLower.includes("cheat_sheet")) {
        return {
          json: {
            guide_type: "CHEAT_SHEET",
            title: guideTitle("Cheat sheet", userPrompt),
            sections: [
              { topic: "Key definitions", content: "Term 1: Definition of the first key concept\nTerm 2: Definition of the second key concept" },
              { topic: "Formulas", content: "Formula 1: A = B + C\nFormula 2: X = Y * Z" },
            ],
          },
          usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
        };
      }
      return {
        json: {
          guide_type: "KEY_CONCEPTS",
          title: guideTitle("Key concepts", userPrompt),
          sections: [
            { concept: "Core principles", explanation: "The ideas the rest of the course material builds on.", importance: "Every later topic assumes them." },
            { concept: "Applied methods", explanation: "The techniques that turn the principles into worked solutions.", importance: "Most exam problems ask you to use one." },
          ],
        },
        usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
      };
    }

    if (systemPrompt.includes("GENERATE_PROMPTS")) {
      if (shouldElicitMalformed(userPrompt)) {
        // Malformed variant: only 2 usable prompts survive validation
        // (< 3 → callers must fall back to deterministic prompts).
        return {
          json: {
            prompts: [
              // Valid FREE_RECALL
              { objective_id: "obj_0", text: "Define the core concept in your own words.", difficulty: 1, format: "FREE_RECALL" },
              // Non-string text — must be dropped
              { objective_id: "obj_0", text: 42, difficulty: 1 },
              // Empty text — must be dropped
              { objective_id: "obj_1", text: "   ", difficulty: 1 },
              // Missing objective_id — must be dropped
              { text: "Orphan question with no objective", difficulty: 2 },
              // MCQ with a 1-based correct_index (off-by-one): text/objective
              // are valid so it survives the drop filter, but it must be
              // demoted to FREE_RECALL rather than scored as an MCQ.
              {
                objective_id: "obj_1",
                text: "Off-by-one MCQ",
                difficulty: 2,
                format: "MCQ",
                choices: ["A", "B", "C", "D"],
                correct_index: 4,
              },
            ],
          },
          usage: { tokenIn: 900, tokenOut: 400, costUsdMicros: 200 },
        };
      }
      return {
        json: {
          prompts: [
            {
              objective_id: "obj_0",
              text: "Which of the following best describes the fundamental principle introduced in the course materials?",
              difficulty: 2,
              format: "MCQ",
              choices: [
                "A foundational rule that governs how the core concepts interact",
                "An optional convention used only in edge cases",
                "A deprecated technique replaced by newer methods",
                "A notation shortcut with no theoretical significance",
              ],
              correct_index: 0,
              distractor_rationales: [
                "Correct. The principle governs how the core concepts interact.",
                "Confuses a foundational requirement with an optional style choice.",
                "Assumes the principle was superseded; it remains current.",
                "Mistakes a load-bearing concept for mere notation.",
              ],
              model_answer: "The fundamental principle is a foundational rule that governs how the core concepts interact.",
              key_points: ["foundational rule", "governs concept interactions"],
            },
            {
              objective_id: "obj_0",
              text: "In your own words, explain how the fundamental principle applies to a practical problem from the course.",
              difficulty: 3,
              format: "FREE_RECALL",
              model_answer: "Applying the principle means identifying the governing rule first, then using it to constrain the solution steps for the practical problem.",
              key_points: ["identify the governing rule", "constrain solution steps", "connect to a concrete example"],
            },
            {
              objective_id: "obj_1",
              text: "A scenario applies the applied method incorrectly. Which error is most likely responsible?",
              difficulty: 3,
              format: "MCQ",
              choices: [
                "Skipping the validation step before applying the method",
                "Using the method on a supported input type",
                "Following the documented procedure in order",
                "Checking boundary conditions twice",
              ],
              correct_index: 0,
              distractor_rationales: [
                "Correct. The method needs the validation step before it applies.",
                "Supported input types are exactly where the method should be used.",
                "Following the documented order is correct usage, not an error.",
                "Re-checking boundaries is redundant but not incorrect.",
              ],
              model_answer: "Skipping the validation step before applying the method causes the failure.",
              key_points: ["validation precedes application", "procedure order matters"],
            },
            {
              objective_id: "obj_1",
              text: "Compare and contrast the two applied methods covered in the materials: when would you choose each?",
              difficulty: 4,
              format: "FREE_RECALL",
              model_answer: "Method one suits well-defined inputs where the validation cost is low; method two costs more to set up but tolerates noisy inputs.",
              key_points: ["method one: well-defined inputs", "method two: tolerates noisy inputs", "trade-off: setup cost vs validation cost"],
            },
          ],
        },
        usage: { tokenIn: 1200, tokenOut: 600, costUsdMicros: 300 },
      };
    }

    if (systemPrompt.includes("GENERATE_FEEDBACK")) {
      if (shouldElicitMalformed(userPrompt)) {
        // Every field has the wrong shape — hardened mappers must drop all
        // of them rather than persisting non-strings into feedbackJson.
        return {
          json: {
            explanation: 42,
            key_takeaway: ["not", "a", "string"],
            concept_connection: { nested: true },
            mnemonic: 3.14,
            pattern_advice: false,
            referenced_chunk_ids: "not-an-array",
          },
          usage: { tokenIn: 600, tokenOut: 150, costUsdMicros: 120 },
        };
      }
      return {
        json: {
          explanation: "Your answer missed the validation step: the method only applies after its preconditions are checked, which is why the result diverged.",
          key_takeaway: "Always verify the preconditions before applying the method.",
          concept_connection: "This mirrors the fundamental principle: governing rules constrain every later step.",
          mnemonic: "V-A-R: Validate, Apply, Review.",
          pattern_advice: "You skipped the setup step in several recent answers. Check the preconditions on the first line of each problem.",
          referenced_chunk_ids: [firstChunkId(userPrompt)],
        },
        usage: { tokenIn: 700, tokenOut: 220, costUsdMicros: 160 },
      };
    }

    if (systemPrompt.includes("GENERATE_WORKED_EXAMPLES")) {
      if (shouldElicitMalformed(userPrompt)) {
        // Every set violates a validity rule — isValidSet must reject all,
        // so the deck generator returns null (deterministic fallback).
        return {
          json: {
            sets: [
              {
                // Step missing its "why"
                objective_id: "obj_0",
                problem: "Compute the result for input 4.",
                steps: [
                  { action: "Write the governing equation", why: "It constrains the unknowns" },
                  { action: "Substitute the input", why: "" },
                ],
                completion_problem_1: "Compute the result for input 5 (final step missing).",
                completion_problem_2: "Compute the result for input 6 (final two steps missing).",
                full_problem: "Compute the result for input 7.",
                model_answer: "The result is 14.",
              },
              {
                // Missing completion problem and model answer
                objective_id: "obj_1",
                problem: "Derive the relation between the two quantities.",
                steps: [
                  { action: "State the definitions", why: "Definitions anchor the derivation" },
                  { action: "Combine them", why: "Yields the relation" },
                ],
                completion_problem_1: "",
                completion_problem_2: "Derive the relation for the alternate case (final two steps missing).",
                full_problem: "Derive the relation for the general case.",
              },
            ],
          },
          usage: { tokenIn: 900, tokenOut: 350, costUsdMicros: 220 },
        };
      }
      return {
        json: {
          sets: [
            {
              objective_id: "obj_0",
              problem: "Worked example: apply the fundamental principle to compute the outcome for a standard input.",
              steps: [
                { action: "Identify the governing rule for the input", why: "The rule determines which relationships hold" },
                { action: "Express the unknown in terms of known quantities", why: "Reduces the problem to substitution" },
                { action: "Substitute the values and simplify", why: "Produces the final outcome in one pass" },
              ],
              completion_problem_1: "Apply the fundamental principle to a slightly larger input; the setup and substitution are given.",
              completion_problem_2: "Apply the fundamental principle to a new input; only the governing rule is given.",
              full_problem: "Apply the fundamental principle end-to-end to an unfamiliar input.",
              model_answer: "Identify the governing rule, express the unknown via known quantities, substitute, and simplify to obtain the outcome.",
            },
            {
              objective_id: "obj_1",
              problem: "Worked example: use the applied method to resolve a practical scenario from the materials.",
              steps: [
                { action: "Validate the scenario against the method's preconditions", why: "The method is only sound when preconditions hold" },
                { action: "Apply the method's documented procedure", why: "Ordered steps prevent skipped constraints" },
                { action: "Review the result against the boundary conditions", why: "Catches off-by-one and edge-case errors" },
              ],
              completion_problem_1: "Resolve a similar scenario. Validation and application are done, so supply the review.",
              completion_problem_2: "Resolve a similar scenario; only the validation is done.",
              full_problem: "Resolve a novel scenario with the applied method, unaided.",
              model_answer: "Validate preconditions, apply the documented procedure in order, then review the result against boundary conditions.",
            },
          ],
        },
        usage: { tokenIn: 1100, tokenOut: 500, costUsdMicros: 260 },
      };
    }

    if (systemPrompt.includes("GENERATE_FLASHCARDS")) {
      return {
        json: {
          cards: [
            { front: "What do the course's core principles cover?", back: "The definitions and rules that every later topic in the course builds on.", tags: ["fundamentals", "definitions"] },
            { front: "How do you apply a concept from the course to a problem?", back: "Name the rule that governs the problem, write down what you know, then use the rule to solve for the unknown.", tags: ["application", "practice"] },
            { front: "What is the relationship between core concepts A and B?", back: "Concept A provides the theoretical foundation, while Concept B extends it into practical applications. They are complementary and often tested together.", tags: ["relationships", "exam prep"] },
          ],
        },
        usage: { tokenIn: 500, tokenOut: 250, costUsdMicros: 120 },
      };
    }

    // Fallback
    return {
      json: { text: "Mock response" },
      usage: { tokenIn: 50, tokenOut: 20, costUsdMicros: 10 },
    };
  }

  clearCallLog() {
    this.callLog.length = 0;
  }
}

export { deterministicEmbedding };
