/**
 * OpenAI API provider — calls the OpenAI REST API directly via fetch.
 *
 * Requires OPENAI_API_KEY environment variable.
 * Supports chat completions (JSON mode) and embeddings.
 */
import type { AiProvider, EmbedResult, CompleteJsonResult } from "../provider";
import { logger } from "@/lib/logger";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

// Timeout for OpenAI API requests — a stalled connection must fail (and trip
// the gateway circuit breaker) rather than hang forever.
const AI_REQUEST_TIMEOUT_MS = parseInt(process.env.AI_REQUEST_TIMEOUT_MS || "60000", 10);

// Pricing in USD micros per 1K tokens (approximate, may vary by model)
const PRICING: Record<string, { inputPer1k: number; outputPer1k: number }> = {
  "gpt-4o-mini": { inputPer1k: 150, outputPer1k: 600 },
  "gpt-4o": { inputPer1k: 2500, outputPer1k: 10000 },
  "gpt-4-turbo": { inputPer1k: 10000, outputPer1k: 30000 },
  "text-embedding-3-small": { inputPer1k: 20, outputPer1k: 0 },
  "text-embedding-3-large": { inputPer1k: 130, outputPer1k: 0 },
};

function getApiKey(): string {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error("OPENAI_API_KEY environment variable is required");
  }
  return key;
}

// Conservative fallback for models missing from PRICING: assume the most
// expensive known pricing so unknown models still count against budget caps
// instead of silently recording $0.
const FALLBACK_PRICING = Object.values(PRICING).reduce((max, p) =>
  p.inputPer1k + p.outputPer1k > max.inputPer1k + max.outputPer1k ? p : max,
);

const warnedUnknownModels = new Set<string>();

function estimateCost(
  model: string,
  tokenIn: number,
  tokenOut: number,
): number {
  let price = PRICING[model];
  if (!price) {
    if (!warnedUnknownModels.has(model)) {
      warnedUnknownModels.add(model);
      logger.warn("openai.unknown_model_pricing", {
        model,
        fallback_input_per_1k: FALLBACK_PRICING.inputPer1k,
        fallback_output_per_1k: FALLBACK_PRICING.outputPer1k,
      });
    }
    price = FALLBACK_PRICING;
  }
  return Math.ceil(
    (tokenIn / 1000) * price.inputPer1k +
      (tokenOut / 1000) * price.outputPer1k,
  );
}

async function openaiRequest(
  path: string,
  body: unknown,
): Promise<unknown> {
  const apiKey = getApiKey();

  let response: Response;
  try {
    response = await fetch(`${OPENAI_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    // Surface timeouts/aborts as a clear error — the thrown error propagates
    // to the gateway, which records the failure for its circuit breaker.
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError")
    ) {
      throw new Error(
        `OpenAI API request timed out after ${AI_REQUEST_TIMEOUT_MS}ms`,
      );
    }
    throw err;
  }

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "unknown");
    throw new Error(
      `OpenAI API error ${response.status}: ${errorBody.slice(0, 500)}`,
    );
  }

  return response.json();
}

interface ChatCompletionResponse {
  choices: { message: { content: string } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface EmbeddingResponse {
  data: { embedding: number[] }[];
  usage?: { prompt_tokens: number; total_tokens: number };
}

export class OpenAIProvider implements AiProvider {
  async embed(texts: string[], model: string): Promise<EmbedResult> {
    const result = (await openaiRequest("/embeddings", {
      model,
      input: texts,
    })) as EmbeddingResponse;

    const embeddings = result.data.map((d) => d.embedding);
    const tokenIn = result.usage?.prompt_tokens ?? 0;

    return {
      embeddings,
      usage: {
        tokenIn,
        tokenOut: 0,
        costUsdMicros: estimateCost(model, tokenIn, 0),
      },
    };
  }

  async completeJson(
    systemPrompt: string,
    userPrompt: string,
    model: string,
  ): Promise<CompleteJsonResult> {
    const result = (await openaiRequest("/chat/completions", {
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    })) as ChatCompletionResponse;

    const content = result.choices[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI returned empty response");
    }

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      throw new Error(
        `OpenAI returned invalid JSON: ${content.slice(0, 200)}`,
      );
    }

    const tokenIn = result.usage?.prompt_tokens ?? 0;
    const tokenOut = result.usage?.completion_tokens ?? 0;

    return {
      json,
      usage: {
        tokenIn,
        tokenOut,
        costUsdMicros: estimateCost(model, tokenIn, tokenOut),
      },
    };
  }
}
