/**
 * AI provider interface.
 *
 * Implementations must handle their own rate limiting and error translation.
 * The gateway handles caching, budgets, and logging.
 */
import type { AiUsage } from "./types";

export interface EmbedResult {
  embeddings: number[][];
  usage?: AiUsage;
}

export interface CompleteJsonResult {
  json: unknown;
  usage?: AiUsage;
}

export interface AiProvider {
  /** Generate embeddings for a batch of texts */
  embed(texts: string[], model: string): Promise<EmbedResult>;

  /** Complete a JSON-structured task */
  completeJson(
    systemPrompt: string,
    userPrompt: string,
    model: string,
  ): Promise<CompleteJsonResult>;
}
