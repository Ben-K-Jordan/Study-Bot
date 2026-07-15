/**
 * Unit tests for the OpenAI provider.
 *
 * Mocks fetch to avoid real API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { logger } from "@/lib/logger";

// Mock the API key
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key-123";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("OpenAIProvider", () => {
  describe("completeJson", () => {
    it("sends correct request and parses response", async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer_markdown: "Test answer",
                citations: [],
              }),
            },
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      const result = await provider.completeJson(
        "You are a helpful assistant",
        "What is 2+2?",
        "gpt-4o-mini",
      );

      expect(result.json).toEqual({
        answer_markdown: "Test answer",
        citations: [],
      });
      expect(result.usage?.tokenIn).toBe(100);
      expect(result.usage?.tokenOut).toBe(50);
      expect(result.usage?.costUsdMicros).toBeGreaterThan(0);

      // Verify the request was made correctly
      expect(fetch).toHaveBeenCalledOnce();
      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format).toEqual({ type: "json_object" });
      expect(body.messages).toHaveLength(2);
      expect((options as RequestInit).headers).toMatchObject({
        Authorization: "Bearer test-key-123",
      });
      expect((options as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("throws on API error", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("Rate limited", { status: 429 }),
      );

      const provider = new OpenAIProvider();
      await expect(
        provider.completeJson("system", "user", "gpt-4o-mini"),
      ).rejects.toThrow("OpenAI API error 429");
    });

    it("throws on invalid JSON response", async () => {
      const mockResponse = {
        choices: [{ message: { content: "not json" } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      await expect(
        provider.completeJson("system", "user", "gpt-4o-mini"),
      ).rejects.toThrow("invalid JSON");
    });

    it("falls back to conservative non-zero pricing for unknown models", async () => {
      const mockResponse = {
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      const result = await provider.completeJson(
        "system",
        "user",
        "gpt-99-not-in-pricing-map",
      );

      // Must never record $0 for an unknown model — falls back to the most
      // expensive known entry (gpt-4-turbo: 10000/30000 micros per 1k):
      // ceil(100/1000 * 10000 + 50/1000 * 30000) = 2500
      expect(result.usage?.costUsdMicros).toBe(2500);
      expect(result.usage?.costUsdMicros).toBeGreaterThan(0);
    });

    it("warns once per unknown model name", async () => {
      const mockResponse = {
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      };

      vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
      const warnSpy = vi.spyOn(logger, "warn");

      const provider = new OpenAIProvider();
      await provider.completeJson("system", "user", "gpt-99-warn-once");
      await provider.completeJson("system", "user", "gpt-99-warn-once");

      const unknownModelWarns = warnSpy.mock.calls.filter(
        ([event]) => event === "openai.unknown_model_pricing",
      );
      expect(unknownModelWarns).toHaveLength(1);
      expect(unknownModelWarns[0][1]).toMatchObject({
        model: "gpt-99-warn-once",
      });
    });

    it("throws on empty response", async () => {
      const mockResponse = {
        choices: [{ message: { content: "" } }],
        usage: { prompt_tokens: 10, completion_tokens: 0 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      await expect(
        provider.completeJson("system", "user", "gpt-4o-mini"),
      ).rejects.toThrow("empty response");
    });
  });

  describe("embed", () => {
    it("sends correct request and returns embeddings", async () => {
      const mockResponse = {
        data: [
          { embedding: [0.1, 0.2, 0.3] },
          { embedding: [0.4, 0.5, 0.6] },
        ],
        usage: { prompt_tokens: 20, total_tokens: 20 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      const result = await provider.embed(
        ["hello", "world"],
        "text-embedding-3-small",
      );

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toEqual([0.1, 0.2, 0.3]);
      expect(result.usage?.tokenIn).toBe(20);
      expect(result.usage?.tokenOut).toBe(0);

      const [url, options] = vi.mocked(fetch).mock.calls[0];
      expect(url).toBe("https://api.openai.com/v1/embeddings");
      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.model).toBe("text-embedding-3-small");
      expect(body.input).toEqual(["hello", "world"]);
    });
  });

  describe("request timeout", () => {
    it("passes an abort signal to fetch", async () => {
      const mockResponse = {
        data: [{ embedding: [0.1] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const provider = new OpenAIProvider();
      await provider.embed(["hello"], "text-embedding-3-small");

      const [, options] = vi.mocked(fetch).mock.calls[0];
      expect((options as RequestInit).signal).toBeInstanceOf(AbortSignal);
    });

    it("surfaces timeout aborts as thrown errors", async () => {
      const timeoutError = new Error("The operation was aborted due to timeout");
      timeoutError.name = "TimeoutError";
      vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(timeoutError);

      const provider = new OpenAIProvider();
      await expect(
        provider.completeJson("system", "user", "gpt-4o-mini"),
      ).rejects.toThrow("timed out after");
    });
  });

  describe("API key validation", () => {
    it("throws when OPENAI_API_KEY is not set", async () => {
      delete process.env.OPENAI_API_KEY;

      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response("{}", { status: 200 }),
      );

      const provider = new OpenAIProvider();
      await expect(
        provider.completeJson("system", "user", "gpt-4o-mini"),
      ).rejects.toThrow("OPENAI_API_KEY");
    });
  });
});

describe("createProvider", () => {
  it("returns MockProvider for mock", async () => {
    process.env.AI_PROVIDER = "mock";
    // Re-import to pick up env change
    const { createProvider } = await import("@/lib/ai/provider-factory");
    const provider = createProvider();
    expect(provider.constructor.name).toBe("MockProvider");
  });

  it("returns OpenAIProvider for openai", async () => {
    process.env.AI_PROVIDER = "openai";
    const { createProvider } = await import("@/lib/ai/provider-factory");
    const provider = createProvider();
    expect(provider.constructor.name).toBe("OpenAIProvider");
  });

  it("throws for unknown provider", async () => {
    process.env.AI_PROVIDER = "unknown";
    const { createProvider } = await import("@/lib/ai/provider-factory");
    expect(() => createProvider()).toThrow("Unknown AI_PROVIDER");
  });
});
