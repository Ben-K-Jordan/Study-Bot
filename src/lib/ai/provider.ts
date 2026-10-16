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

/**
 * HTTP statuses that mean the provider refused this one request because of
 * what it contained (too long, malformed), while the provider itself is up.
 */
export const REQUEST_ERROR_STATUSES: ReadonlySet<number> = new Set([400, 413, 422]);

/**
 * Thrown by a provider for a request it rejected on its content (see
 * REQUEST_ERROR_STATUSES). The gateway leaves these out of its circuit
 * breaker, which is shared by every user: one student's oversized input
 * must not switch AI off for everyone.
 */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
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
