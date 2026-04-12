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
          answer_markdown: "Based on the provided materials, the key concept involves understanding the fundamental principles and their applications.",
          citations: [
            { chunk_id: "mock_chunk_1", reason: "Directly relevant definition", quote_snippet: "The concept is defined as..." },
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
              title: "Fundamental Concepts",
              description: "Understand the core principles and definitions covered in the course material.",
              difficulty: 1,
              keywords: ["fundamentals", "definitions", "core concepts"],
            },
            {
              title: "Applied Problem Solving",
              description: "Apply theoretical knowledge to solve practical problems.",
              difficulty: 3,
              keywords: ["application", "problem solving", "practice"],
            },
            {
              title: "Critical Analysis",
              description: "Evaluate and analyze complex scenarios using course frameworks.",
              difficulty: 4,
              keywords: ["analysis", "evaluation", "critical thinking"],
            },
            {
              title: "Integration and Synthesis",
              description: "Synthesize concepts across multiple topics into cohesive understanding.",
              difficulty: 5,
              keywords: ["synthesis", "integration", "connections"],
            },
            {
              title: "Key Terminology",
              description: "Master domain-specific vocabulary and notation.",
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
        json: { blocks: null, reasoning: "Mock provider — using deterministic fallback." },
        usage: { tokenIn: 200, tokenOut: 50, costUsdMicros: 30 },
      };
    }

    if (systemPrompt.includes("SUMMARIZE_DOCUMENT")) {
      return {
        json: {
          summary: "This document covers fundamental concepts including key definitions, core principles, and practical applications relevant to the course.",
          suggested_questions: [
            "What are the main concepts covered in this document?",
            "How do these concepts relate to each other?",
            "What are the practical applications of these ideas?",
          ],
        },
        usage: { tokenIn: 400, tokenOut: 100, costUsdMicros: 75 },
      };
    }

    if (systemPrompt.includes("GENERATE_STUDY_GUIDE")) {
      // Detect guide type from user prompt
      if (userPrompt.includes("FAQ")) {
        return {
          json: {
            guide_type: "FAQ",
            title: "Frequently Asked Questions",
            sections: [
              { question: "What are the core concepts?", answer: "The core concepts include fundamental principles covered in the course materials." },
              { question: "How are these concepts applied?", answer: "These concepts are applied through problem-solving and analytical frameworks." },
            ],
          },
          usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
        };
      }
      if (userPrompt.includes("CHEAT_SHEET")) {
        return {
          json: {
            guide_type: "CHEAT_SHEET",
            title: "Quick Reference Sheet",
            sections: [
              { topic: "Key Definitions", content: "Term 1: Definition of the first key concept\nTerm 2: Definition of the second key concept" },
              { topic: "Important Formulas", content: "Formula 1: A = B + C\nFormula 2: X = Y * Z" },
            ],
          },
          usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
        };
      }
      return {
        json: {
          guide_type: "KEY_CONCEPTS",
          title: "Key Concepts Guide",
          sections: [
            { concept: "Fundamental Principles", explanation: "The foundational ideas that form the basis of the course material.", importance: "Required for understanding all advanced topics." },
            { concept: "Applied Methods", explanation: "Techniques used to put theoretical knowledge into practice.", importance: "Essential for exam problem-solving." },
          ],
        },
        usage: { tokenIn: 600, tokenOut: 200, costUsdMicros: 150 },
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
