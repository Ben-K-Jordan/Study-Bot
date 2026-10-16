/**
 * The optional daily AI ceiling across every account
 * (AI_GLOBAL_DAILY_COST_CAP_USD). Sign-up is open, so the per-account caps
 * (ai-gateway.test.ts) alone don't bound what the operator pays. The gateway
 * reads its caps when it loads, so this file sets the ceiling first.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

vi.hoisted(() => {
  vi.stubEnv("AI_GLOBAL_DAILY_COST_CAP_USD", "5");
});

vi.mock("@/lib/db", () => ({
  prisma: {
    aiCallLog: {
      create: vi.fn(async () => ({})),
      aggregate: vi.fn(),
    },
    aiCache: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
  },
}));

import { runTask, embed, resetCircuitBreaker, GatewayError } from "@/lib/ai/gateway";
import { MockProvider } from "@/lib/ai/providers/mock";
import { AiTask } from "@/lib/ai/types";
import { getPrompt } from "@/lib/ai/prompt-registry";
import { prisma } from "@/lib/db";

type AggregateArgs = { where: Record<string, unknown> };

const aggregate = vi.mocked(prisma.aiCallLog.aggregate);

/** Spend in dollars: today's total across accounts, and any one account's. */
let spend = { allAccounts: 0, oneAccount: 0 };

function micros(usd: number) {
  return { _sum: { costUsdMicros: BigInt(Math.round(usd * 1_000_000)) } };
}

/** Aggregate calls without a userId filter, the ones that sum every account. */
function globalReads(): AggregateArgs[] {
  return aggregate.mock.calls.map((call) => call[0] as AggregateArgs).filter((args) => !("userId" in args.where));
}

const prompt = getPrompt(AiTask.SUGGEST_ERROR_TYPE);
const spec = {
  task: AiTask.SUGGEST_ERROR_TYPE,
  promptVersion: prompt.version,
  model: "test-model",
  input: { question: "Q", userAnswer: "A", correctConcept: "C" },
  parseOutput: (raw: unknown) => raw,
};

async function budgetError(promise: Promise<unknown>): Promise<GatewayError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(GatewayError);
  return err as GatewayError;
}

describe("AI ceiling across every account", () => {
  let provider: MockProvider;

  beforeEach(() => {
    provider = new MockProvider();
    resetCircuitBreaker();
    vi.clearAllMocks();
    spend = { allAccounts: 0, oneAccount: 0 };
    aggregate.mockImplementation((async (args: AggregateArgs) =>
      micros("userId" in args.where ? spend.oneAccount : spend.allAccounts)) as never);
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("stops every account once today's total reaches the ceiling", async () => {
    spend = { allAccounts: 5, oneAccount: 0 };
    const completeJson = vi.spyOn(provider, "completeJson");

    for (const userId of ["fresh-account-1", "fresh-account-2"]) {
      const err = await budgetError(runTask({ userId, provider }, spec, { skipCache: true }));
      expect(err.code).toBe("BUDGET_EXCEEDED");
      expect(err.message).toBe("Daily AI budget for all accounts reached: $5.00 of $5.00 spent.");
    }
    expect(completeJson).not.toHaveBeenCalled();
  });

  it("sums today's spend with no account filter, once a minute", async () => {
    spend = { allAccounts: 4.99, oneAccount: 0 };

    await runTask({ userId: "account-a", provider }, spec, { skipCache: true });
    await runTask({ userId: "account-b", provider }, spec, { skipCache: true });

    const reads = globalReads();
    expect(reads).toHaveLength(1);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    expect(reads[0].where).toEqual({ createdAt: { gte: startOfDay }, status: "OK" });
  });

  it("covers embedding uploads and search queries too", async () => {
    spend = { allAccounts: 6, oneAccount: 0 };

    const upload = await budgetError(embed({ userId: "u1", provider }, ["chunk"], "text-embedding-3-small", { budget: "upload" }));
    expect(upload.code).toBe("BUDGET_EXCEEDED");
    const search = await budgetError(embed({ userId: "u1", provider }, ["query"], "text-embedding-3-small"));
    expect(search.code).toBe("BUDGET_EXCEEDED");
  });

  it("still applies each account's own cap under the ceiling", async () => {
    spend = { allAccounts: 2, oneAccount: 1_000 };

    const err = await budgetError(runTask({ userId: "busy-account", provider }, spec, { skipCache: true }));
    expect(err.code).toBe("BUDGET_EXCEEDED");
    expect(err.message).toMatch(/^(Daily|Monthly) AI budget reached/);
  });

  it("asks the database again after a failed read", async () => {
    aggregate.mockRejectedValueOnce(new Error("connection reset"));
    await expect(runTask({ userId: "u1", provider }, spec, { skipCache: true })).rejects.toThrow("connection reset");

    await expect(runTask({ userId: "u1", provider }, spec, { skipCache: true })).resolves.toBeDefined();
    expect(globalReads()).toHaveLength(2);
  });
});
