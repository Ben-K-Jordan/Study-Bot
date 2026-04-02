/**
 * AI Gateway — the single entry point for all AI operations.
 *
 * Responsibilities:
 * 1. Cache lookup (AiCache table) with SHA-256 key hashing
 * 2. Per-user daily cost budget enforcement
 * 3. Provider dispatch (completeJson / embed)
 * 4. Call logging (AiCallLog table)
 * 5. Basic circuit-breaker semantics (consecutive failure tracking)
 */
import { createHash } from "crypto";
import { prisma } from "../db";
import type { AiProvider } from "./provider";
import type { AiTask, AiUsage, AiCallMeta, TaskSpec, RunTaskResult } from "./types";
import { getPrompt } from "./prompt-registry";

// ---------------------------------------------------------------------------
// Configuration (env-driven with sensible defaults)
// ---------------------------------------------------------------------------

const AI_CACHE_TTL_SECONDS = parseInt(process.env.AI_CACHE_TTL_SECONDS || "3600", 10);
const AI_DAILY_COST_CAP_USD = parseFloat(process.env.AI_DAILY_COST_CAP_USD || "5.0");
const AI_DISABLED = process.env.AI_DISABLED === "true";
const CIRCUIT_BREAKER_THRESHOLD = 5; // consecutive failures before opening circuit
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute cooldown

// ---------------------------------------------------------------------------
// Circuit breaker state (in-process, resets on restart)
// ---------------------------------------------------------------------------

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function recordSuccess() {
  consecutiveFailures = 0;
}

function recordFailure() {
  consecutiveFailures++;
  if (consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
    circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_RESET_MS;
  }
}

function isCircuitOpen(): boolean {
  if (consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD) return false;
  if (Date.now() > circuitOpenUntil) {
    // Half-open: allow one attempt
    consecutiveFailures = CIRCUIT_BREAKER_THRESHOLD - 1;
    return false;
  }
  return true;
}

/** Reset circuit breaker state — exposed for tests. */
export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
}

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Deterministic cache key from task + model + prompt version + input. */
function buildCacheKey(task: string, model: string, promptVersion: string, input: unknown): string {
  const canonical = JSON.stringify({ task, model, promptVersion, input });
  return sha256(canonical);
}

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

interface BudgetCheckResult {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
}

async function checkDailyBudget(userId: string): Promise<BudgetCheckResult> {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const result = await prisma.aiCallLog.aggregate({
    where: {
      userId,
      createdAt: { gte: startOfDay },
      status: "OK",
    },
    _sum: { costUsdMicros: true },
  });

  const spentMicros = Number(result._sum.costUsdMicros ?? 0);
  const spentUsd = spentMicros / 1_000_000;

  return {
    allowed: spentUsd < AI_DAILY_COST_CAP_USD,
    spentUsd,
    capUsd: AI_DAILY_COST_CAP_USD,
  };
}

// ---------------------------------------------------------------------------
// Cache operations
// ---------------------------------------------------------------------------

async function cacheGet(keyHash: string): Promise<{ outputJson: unknown } | null> {
  const entry = await prisma.aiCache.findFirst({
    where: {
      keyHash,
      expiresAt: { gt: new Date() },
    },
  });

  if (!entry) return null;

  // Bump hit count (fire-and-forget)
  prisma.aiCache
    .update({
      where: { keyHash },
      data: { hitCount: { increment: 1 }, lastHitAt: new Date() },
    })
    .catch(() => {
      /* best-effort */
    });

  return { outputJson: entry.outputJson };
}

async function cacheSet(
  keyHash: string,
  task: string,
  model: string,
  promptVersion: string,
  inputFingerprint: string,
  outputJson: unknown,
): Promise<void> {
  const expiresAt = new Date(Date.now() + AI_CACHE_TTL_SECONDS * 1000);

  await prisma.aiCache.upsert({
    where: { keyHash },
    create: {
      keyHash,
      task,
      model,
      promptVersion,
      inputFingerprint,
      outputJson: outputJson as never,
      expiresAt,
    },
    update: {
      outputJson: outputJson as never,
      expiresAt,
      hitCount: 0,
      lastHitAt: null,
    },
  });
}

// ---------------------------------------------------------------------------
// Call logging
// ---------------------------------------------------------------------------

async function logCall(params: {
  userId: string;
  task: string;
  model: string;
  promptVersion: string;
  cacheHit: boolean;
  latencyMs: number;
  usage?: AiUsage;
  status: "OK" | "ERROR";
  errorCode?: string;
}): Promise<void> {
  await prisma.aiCallLog.create({
    data: {
      userId: params.userId,
      task: params.task,
      model: params.model,
      promptVersion: params.promptVersion,
      cacheHit: params.cacheHit,
      latencyMs: params.latencyMs,
      tokenIn: params.usage?.tokenIn ?? null,
      tokenOut: params.usage?.tokenOut ?? null,
      costUsdMicros: params.usage?.costUsdMicros != null ? BigInt(params.usage.costUsdMicros) : null,
      status: params.status,
      errorCode: params.errorCode ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// Gateway context
// ---------------------------------------------------------------------------

export interface GatewayContext {
  userId: string;
  provider: AiProvider;
}

export interface RunTaskOptions {
  /** Skip cache lookup/write */
  skipCache?: boolean;
  /** Skip budget check */
  skipBudget?: boolean;
}

// ---------------------------------------------------------------------------
// Core: runTask
// ---------------------------------------------------------------------------

/**
 * Execute an AI task through the gateway pipeline:
 * 1. Check AI_DISABLED flag
 * 2. Check circuit breaker
 * 3. Cache lookup
 * 4. Budget enforcement
 * 5. Provider call
 * 6. Cache write
 * 7. Log call
 */
export async function runTask<T>(
  ctx: GatewayContext,
  spec: TaskSpec<T>,
  opts: RunTaskOptions = {},
): Promise<RunTaskResult<T>> {
  if (AI_DISABLED) {
    throw new GatewayError("AI_DISABLED", "AI features are disabled", false);
  }

  if (isCircuitOpen()) {
    throw new GatewayError("CIRCUIT_OPEN", "AI circuit breaker is open — too many recent failures", true);
  }

  const { task, model, promptVersion, input, parseOutput } = spec;
  const prompt = getPrompt(task);
  const cacheKey = buildCacheKey(task, model, promptVersion, input);
  const startMs = Date.now();

  // --- Cache check ---
  if (!opts.skipCache) {
    const cached = await cacheGet(cacheKey);
    if (cached) {
      const output = parseOutput(cached.outputJson);
      const meta: AiCallMeta = {
        cacheHit: true,
        latencyMs: Date.now() - startMs,
        promptVersion,
        model,
        task,
      };

      // Log cache hit (fire-and-forget)
      logCall({
        userId: ctx.userId,
        task,
        model,
        promptVersion,
        cacheHit: true,
        latencyMs: meta.latencyMs,
        status: "OK",
      }).catch(() => {});

      return { output, meta };
    }
  }

  // --- Budget check ---
  if (!opts.skipBudget) {
    const budget = await checkDailyBudget(ctx.userId);
    if (!budget.allowed) {
      throw new GatewayError(
        "BUDGET_EXCEEDED",
        `Daily AI budget exceeded: $${budget.spentUsd.toFixed(2)} / $${budget.capUsd.toFixed(2)}`,
        false,
      );
    }
  }

  // --- Provider call ---
  let usage: AiUsage | undefined;
  let rawOutput: unknown;

  try {
    const systemPrompt = prompt.systemPrompt;
    const userPrompt = prompt.buildUserPrompt(input);
    const result = await ctx.provider.completeJson(systemPrompt, userPrompt, model);
    rawOutput = result.json;
    usage = result.usage;
    recordSuccess();
  } catch (err) {
    recordFailure();
    const latencyMs = Date.now() - startMs;
    const errorCode = err instanceof Error ? err.message.slice(0, 100) : "UNKNOWN";

    // Log failure
    await logCall({
      userId: ctx.userId,
      task,
      model,
      promptVersion,
      cacheHit: false,
      latencyMs,
      status: "ERROR",
      errorCode,
    }).catch(() => {});

    throw new GatewayError("PROVIDER_ERROR", `AI provider failed: ${errorCode}`, true);
  }

  const latencyMs = Date.now() - startMs;

  // --- Parse output ---
  const output = parseOutput(rawOutput);

  // --- Cache write (fire-and-forget) ---
  if (!opts.skipCache) {
    const inputFingerprint = sha256(JSON.stringify(input));
    cacheSet(cacheKey, task, model, promptVersion, inputFingerprint, rawOutput).catch(() => {});
  }

  // --- Log call ---
  const meta: AiCallMeta = {
    cacheHit: false,
    latencyMs,
    promptVersion,
    model,
    task,
  };

  await logCall({
    userId: ctx.userId,
    task,
    model,
    promptVersion,
    cacheHit: false,
    latencyMs,
    usage,
    status: "OK",
  }).catch(() => {});

  return { output, meta };
}

// ---------------------------------------------------------------------------
// Embed shortcut (no prompts, no cache — embeddings are stored in DB directly)
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  skipBudget?: boolean;
}

export async function embed(
  ctx: GatewayContext,
  texts: string[],
  model: string,
  opts: EmbedOptions = {},
): Promise<{ embeddings: number[][]; usage?: AiUsage }> {
  if (AI_DISABLED) {
    throw new GatewayError("AI_DISABLED", "AI features are disabled", false);
  }

  if (isCircuitOpen()) {
    throw new GatewayError("CIRCUIT_OPEN", "AI circuit breaker is open — too many recent failures", true);
  }

  if (!opts.skipBudget) {
    const budget = await checkDailyBudget(ctx.userId);
    if (!budget.allowed) {
      throw new GatewayError(
        "BUDGET_EXCEEDED",
        `Daily AI budget exceeded: $${budget.spentUsd.toFixed(2)} / $${budget.capUsd.toFixed(2)}`,
        false,
      );
    }
  }

  const startMs = Date.now();

  try {
    const result = await ctx.provider.embed(texts, model);
    recordSuccess();

    const latencyMs = Date.now() - startMs;
    await logCall({
      userId: ctx.userId,
      task: "EMBED_TEXTS",
      model,
      promptVersion: "n/a",
      cacheHit: false,
      latencyMs,
      usage: result.usage,
      status: "OK",
    }).catch(() => {});

    return { embeddings: result.embeddings, usage: result.usage };
  } catch (err) {
    recordFailure();
    const latencyMs = Date.now() - startMs;
    const errorCode = err instanceof Error ? err.message.slice(0, 100) : "UNKNOWN";

    await logCall({
      userId: ctx.userId,
      task: "EMBED_TEXTS",
      model,
      promptVersion: "n/a",
      cacheHit: false,
      latencyMs,
      status: "ERROR",
      errorCode,
    }).catch(() => {});

    throw new GatewayError("PROVIDER_ERROR", `Embedding failed: ${errorCode}`, true);
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
