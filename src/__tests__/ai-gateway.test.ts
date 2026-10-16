/**
 * Unit tests for the AI Gateway — cache, budget, circuit breaker.
 *
 * Uses MockProvider + in-memory Prisma mocks to isolate gateway logic.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MockProvider, deterministicEmbedding } from "@/lib/ai/providers/mock";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";

// Mock prisma before importing gateway
vi.mock("@/lib/db", () => {
  const aiCallLogs: Record<string, unknown>[] = [];
  const aiCacheEntries = new Map<string, Record<string, unknown>>();

  return {
    prisma: {
      aiCallLog: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          aiCallLogs.push(data);
          return data;
        }),
        aggregate: vi.fn(async () => ({
          _sum: { costUsdMicros: 0n },
        })),
        groupBy: vi.fn(async () => []),
      },
      aiCache: {
        findFirst: vi.fn(async ({ where }: { where: { keyHash: string } }) => {
          return aiCacheEntries.get(where.keyHash) ?? null;
        }),
        upsert: vi.fn(async ({ where, create }: { where: { keyHash: string }; create: Record<string, unknown> }) => {
          aiCacheEntries.set(where.keyHash, create);
          return create;
        }),
        update: vi.fn(async () => ({})),
        deleteMany: vi.fn(async ({ where }: { where: { keyHash: string } }) => {
          aiCacheEntries.delete(where.keyHash);
          return { count: 1 };
        }),
      },
      _test: { aiCallLogs, aiCacheEntries },
    },
  };
});

import { runTask, embed, resetCircuitBreaker, GatewayError } from "@/lib/ai/gateway";
import { ProviderRequestError } from "@/lib/ai/provider";
import { prisma } from "@/lib/db";

const testPrisma = (prisma as unknown as { _test: { aiCallLogs: unknown[]; aiCacheEntries: Map<string, unknown> } })._test;

describe("AI Gateway", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
    resetCircuitBreaker();
    testPrisma.aiCallLogs.length = 0;
    testPrisma.aiCacheEntries.clear();
    vi.clearAllMocks();
  });

  describe("runTask", () => {
    it("calls provider and returns parsed output", async () => {
      const prompt = getPrompt(AiTask.ANSWER_WITH_CITATIONS);
      const result = await runTask(
        { userId: "user1", provider },
        {
          task: AiTask.ANSWER_WITH_CITATIONS,
          promptVersion: prompt.version,
          model: "test-model",
          input: {
            question: "What is X?",
            chunks: [{ chunk_id: "c1", title: "Doc", text: "X is..." }],
            verbosity: "SHORT",
          },
          parseOutput: (raw) => raw as { answer_markdown: string },
        },
      );

      expect(result.output.answer_markdown).toBeTruthy();
      expect(result.meta.cacheHit).toBe(false);
      expect(result.meta.task).toBe(AiTask.ANSWER_WITH_CITATIONS);
      expect(provider.callLog).toHaveLength(1);
    });

    it("returns cached result on second call", async () => {
      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      const spec = {
        task: AiTask.SUGGEST_ERROR_TYPE,
        promptVersion: prompt.version,
        model: "test-model",
        input: { question: "Q", userAnswer: "A", correctConcept: "C" },
        parseOutput: (raw: unknown) => raw as { error_type: string },
      };
      const ctx = { userId: "user1", provider };

      // First call — cache miss
      const r1 = await runTask(ctx, spec);
      expect(r1.meta.cacheHit).toBe(false);

      // Second call — cache hit
      const r2 = await runTask(ctx, spec);
      expect(r2.meta.cacheHit).toBe(true);
      expect(r2.output.error_type).toBe(r1.output.error_type);

      // Provider should only have been called once
      expect(provider.callLog).toHaveLength(1);
    });

    it("treats a cached entry that no longer parses as a miss and evicts it", async () => {
      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      const base = {
        task: AiTask.SUGGEST_ERROR_TYPE,
        promptVersion: prompt.version,
        model: "test-model",
        input: { question: "Q", userAnswer: "A", correctConcept: "C" },
      };
      const ctx = { userId: "user1", provider };

      await runTask(ctx, { ...base, parseOutput: (raw: unknown) => raw as { error_type: string } });
      expect(testPrisma.aiCacheEntries.size).toBe(1);

      let calls = 0;
      const strict = (raw: unknown) => {
        calls++;
        if (calls === 1) throw new Error("stale shape");
        return raw as { error_type: string };
      };
      const r2 = await runTask(ctx, { ...base, parseOutput: strict });

      expect(r2.meta.cacheHit).toBe(false);
      expect(provider.callLog).toHaveLength(2);
      expect(vi.mocked(prisma.aiCache.deleteMany)).toHaveBeenCalledTimes(1);
    });

    it("skips cache when skipCache is true", async () => {
      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      const spec = {
        task: AiTask.SUGGEST_ERROR_TYPE,
        promptVersion: prompt.version,
        model: "test-model",
        input: { question: "Q", userAnswer: "A", correctConcept: "C" },
        parseOutput: (raw: unknown) => raw as { error_type: string },
      };
      const ctx = { userId: "user1", provider };

      await runTask(ctx, spec);
      await runTask(ctx, spec, { skipCache: true });

      // Provider called both times
      expect(provider.callLog).toHaveLength(2);
    });
  });

  describe("budget enforcement", () => {
    it("blocks calls when budget is exceeded", async () => {
      // Mock aggregate to return high cost
      vi.mocked(prisma.aiCallLog.aggregate).mockResolvedValueOnce({
        _sum: { costUsdMicros: 10_000_000n }, // $10
        _count: 0,
        _avg: {},
        _min: {},
        _max: {},
      } as never);

      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      await expect(
        runTask(
          { userId: "user1", provider },
          {
            task: AiTask.SUGGEST_ERROR_TYPE,
            promptVersion: prompt.version,
            model: "test-model",
            input: { question: "Q", userAnswer: "A", correctConcept: "C" },
            parseOutput: (raw: unknown) => raw,
          },
        ),
      ).rejects.toThrow(GatewayError);
    });
  });

  describe("circuit breaker", () => {
    it("opens after consecutive failures", async () => {
      const failingProvider = {
        embed: vi.fn().mockRejectedValue(new Error("fail")),
        completeJson: vi.fn().mockRejectedValue(new Error("fail")),
      };

      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      const spec = {
        task: AiTask.SUGGEST_ERROR_TYPE,
        promptVersion: prompt.version,
        model: "m",
        input: { question: "Q", userAnswer: "A", correctConcept: "C" },
        parseOutput: (raw: unknown) => raw,
      };
      const ctx = { userId: "user1", provider: failingProvider };

      // Trigger 5 consecutive failures
      for (let i = 0; i < 5; i++) {
        await expect(runTask(ctx, spec, { skipCache: true, skipBudget: true })).rejects.toThrow();
      }

      // 6th call should be blocked by circuit breaker
      await expect(runTask(ctx, spec, { skipCache: true, skipBudget: true })).rejects.toThrow("circuit breaker");
    });

    it("doesn't count requests the provider refused for their content", async () => {
      const tooLong = new ProviderRequestError("OpenAI API error 400: context_length_exceeded", 400);
      const refusingProvider = {
        embed: vi.fn().mockRejectedValue(tooLong),
        completeJson: vi.fn().mockRejectedValue(tooLong),
      };
      const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
      const spec = {
        task: AiTask.SUGGEST_ERROR_TYPE,
        promptVersion: prompt.version,
        model: "m",
        input: { question: "Q", userAnswer: "A", correctConcept: "C" },
        parseOutput: (raw: unknown) => raw,
      };

      for (let i = 0; i < 8; i++) {
        const err = await runTask({ userId: "attacker", provider: refusingProvider }, spec, {
          skipCache: true,
          skipBudget: true,
        }).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(GatewayError);
        expect((err as GatewayError).code).toBe("PROVIDER_ERROR");
        expect((err as GatewayError).retryable).toBe(false);
      }

      // Another student's request still reaches the provider
      const result = await runTask({ userId: "user2", provider }, spec, { skipCache: true, skipBudget: true });
      expect(result.meta.cacheHit).toBe(false);
      expect(provider.callLog).toHaveLength(1);
    });
  });

  describe("embed budget", () => {
    const aggregateMock = () => vi.mocked(prisma.aiCallLog.aggregate);
    const spent = (usd: number) =>
      ({ _sum: { costUsdMicros: BigInt(Math.round(usd * 1_000_000)) } }) as never;

    it("checks uploads against today's embedding spend, not all AI spend", async () => {
      await embed({ userId: "user1", provider }, ["chunk"], "text-embedding-3-small", { budget: "upload" });

      const wheres = aggregateMock().mock.calls.map((c) => (c[0] as { where: Record<string, unknown> }).where);
      expect(wheres).toHaveLength(2);
      expect(wheres[0]).toMatchObject({ userId: "user1", task: "EMBED_TEXTS", status: "OK" });
      expect(wheres[1]).not.toHaveProperty("task");
      expect(provider.callLog).toHaveLength(1);
    });

    it("stops an upload once today's embedding cap is spent", async () => {
      aggregateMock().mockResolvedValueOnce(spent(0.5)).mockResolvedValueOnce(spent(0.5));

      const err = await embed({ userId: "user1", provider }, ["chunk"], "text-embedding-3-small", {
        budget: "upload",
      }).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(GatewayError);
      expect((err as GatewayError).code).toBe("BUDGET_EXCEEDED");
      expect((err as GatewayError).message).toMatch(/^Daily embedding budget reached/);
      expect(provider.callLog).toHaveLength(0);
    });

    it("stops an upload once the monthly AI cap is spent", async () => {
      aggregateMock().mockResolvedValueOnce(spent(0)).mockResolvedValueOnce(spent(50));

      const err = await embed({ userId: "user1", provider }, ["chunk"], "text-embedding-3-small", {
        budget: "upload",
      }).catch((e: unknown) => e);

      expect((err as GatewayError).code).toBe("BUDGET_EXCEEDED");
      expect((err as GatewayError).message).toMatch(/^Monthly embedding budget reached/);
    });

    it("re-reads spend for every upload slice instead of caching it", async () => {
      const ctx = { userId: "user1", provider };
      await embed(ctx, ["a"], "text-embedding-3-small", { budget: "upload" });
      await embed(ctx, ["b"], "text-embedding-3-small", { budget: "upload" });
      expect(aggregateMock()).toHaveBeenCalledTimes(4);
    });
  });

  describe("embed", () => {
    it("generates embeddings via provider", async () => {
      const result = await embed(
        { userId: "user1", provider },
        ["hello world", "test"],
        "text-embedding-3-small",
      );

      expect(result.embeddings).toHaveLength(2);
      expect(result.embeddings[0]).toHaveLength(1536);
      expect(provider.callLog).toHaveLength(1);
      expect(provider.callLog[0].method).toBe("embed");
    });
  });
});

describe("deterministicEmbedding", () => {
  it("produces same vector for same input", () => {
    const v1 = deterministicEmbedding("hello");
    const v2 = deterministicEmbedding("hello");
    expect(v1).toEqual(v2);
  });

  it("produces different vectors for different inputs", () => {
    const v1 = deterministicEmbedding("hello");
    const v2 = deterministicEmbedding("world");
    expect(v1).not.toEqual(v2);
  });

  it("produces L2-normalized vectors", () => {
    const v = deterministicEmbedding("test");
    const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
    expect(norm).toBeCloseTo(1.0, 5);
  });
});
