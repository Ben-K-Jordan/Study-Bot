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
