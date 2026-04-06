/**
 * AI provider factory — instantiates the configured provider.
 *
 * Reads AI_PROVIDER env var: "mock" (default) | "openai"
 */
import type { AiProvider } from "./provider";
import { MockProvider } from "./providers/mock";
import { OpenAIProvider } from "./providers/openai";

export function createProvider(): AiProvider {
  const name = process.env.AI_PROVIDER || "mock";

  switch (name) {
    case "mock":
      return new MockProvider();
    case "openai":
      return new OpenAIProvider();
    default:
      throw new Error(
        `Unknown AI_PROVIDER: "${name}". Valid values: mock, openai`,
      );
  }
}
