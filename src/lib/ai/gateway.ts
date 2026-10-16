/**
 * AI Gateway: the single entry point for all AI operations.
 *
 * Responsibilities:
 * 1. Cache lookup (AiCache table) with SHA-256 key hashing
 * 2. Cost budgets: per-user daily and monthly caps, plus an optional daily
 *    ceiling across all accounts (AI_GLOBAL_DAILY_COST_CAP_USD)
 * 3. Provider dispatch (completeJson / embed)
 * 4. Call logging (AiCallLog table)
 * 5. Basic circuit-breaker semantics (consecutive failure tracking)
 */
import { createHash } from "crypto";
import { prisma } from "../db";
import { ProviderRequestError, type AiProvider } from "./provider";
import type { AiUsage, AiCallMeta, TaskSpec, RunTaskResult } from "./types";
import { getPrompt } from "./prompt-registry";

// ---------------------------------------------------------------------------
// Configuration (env-driven with sensible defaults)
// ---------------------------------------------------------------------------

const AI_CACHE_TTL_SECONDS = parseInt(process.env.AI_CACHE_TTL_SECONDS || "3600", 10);
const AI_DAILY_COST_CAP_USD = parseFloat(process.env.AI_DAILY_COST_CAP_USD || "1.0");
const AI_MONTHLY_COST_CAP_USD = parseFloat(process.env.AI_MONTHLY_COST_CAP_USD || "10.0");
// Background embedding of uploaded files has its own daily cap, so an upload
// still embeds after the student has used AI today, while repeated uploads
// can't spend without limit. $0.10 is about 5M tokens with
// text-embedding-3-small, roughly 20 MB of extracted text a day.
const AI_DAILY_EMBED_COST_CAP_USD = parseFloat(process.env.AI_DAILY_EMBED_COST_CAP_USD || "0.10");
// The caps above are per account, and sign-up is open, so new accounts each
// bring a fresh daily budget. This optional ceiling covers every account
// together; unset (the default) means no ceiling.
const AI_GLOBAL_DAILY_COST_CAP_USD = optionalCap(process.env.AI_GLOBAL_DAILY_COST_CAP_USD);
const AI_DISABLED = process.env.AI_DISABLED === "true";
const CIRCUIT_BREAKER_THRESHOLD = 5; // consecutive failures before opening circuit
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute cooldown
const CIRCUIT_OPEN_MESSAGE = "AI circuit breaker is open after too many recent failures";

/** AiCallLog task name for embedding calls (uploads and search queries). */
export const EMBED_TASK = "EMBED_TEXTS";

/** A dollar cap from the environment; null when unset or not a number. */
function optionalCap(raw: string | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// ---------------------------------------------------------------------------
// Circuit breaker state (in-process, resets on restart)
// ---------------------------------------------------------------------------

let consecutiveFailures = 0;
let circuitOpenUntil = 0;

function recordSuccess() {
  consecutiveFailures = 0;
}

/**
 * Count a failed provider call toward the breaker. A request the provider
 * refused for its own content (ProviderRequestError, such as an input past the
 * context window) is skipped: the breaker is shared by every user, so one
 * user's bad input must not cut AI off for the rest.
 */
function recordFailure(err: unknown) {
  if (err instanceof ProviderRequestError) return;
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

// ---------------------------------------------------------------------------
// Budget enforcement
// ---------------------------------------------------------------------------

interface BudgetCheckResult {
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
  period: "daily" | "monthly";
  /** "global" when the ceiling across every account was reached. */
  scope?: "global";
}

// In-memory budget cache to avoid aggregate queries on every AI call
const BUDGET_CACHE_TTL_MS = 60_000; // 1 minute
const budgetCache = new Map<string, { result: BudgetCheckResult; expiresAt: number }>();
// Today's spend across every account, shared by concurrent checks.
let globalSpendCache: { spent: Promise<number>; expiresAt: number } | null = null;

/** Reset circuit breaker and budget cache state (exposed for tests). */
export function resetCircuitBreaker() {
  consecutiveFailures = 0;
  circuitOpenUntil = 0;
  budgetCache.clear();
  globalSpendCache = null;
}

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Start of the current UTC day and month; budgets reset on UTC boundaries. */
function budgetWindows(now = new Date()): { startOfDay: Date; startOfMonth: Date } {
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const startOfMonth = new Date(startOfDay);
  startOfMonth.setUTCDate(1);
  return { startOfDay, startOfMonth };
}

async function spentUsd(where: Record<string, unknown>): Promise<number> {
  const result = await prisma.aiCallLog.aggregate({
    where: { ...where, status: "OK" },
    _sum: { costUsdMicros: true },
  });
  return Number(result._sum.costUsdMicros ?? 0) / 1_000_000;
}

function budgetResult(daily: number, dailyCap: number, monthly: number): BudgetCheckResult {
  if (monthly >= AI_MONTHLY_COST_CAP_USD) {
    return { allowed: false, spentUsd: monthly, capUsd: AI_MONTHLY_COST_CAP_USD, period: "monthly" };
  }
  return { allowed: daily < dailyCap, spentUsd: daily, capUsd: dailyCap, period: "daily" };
}

function budgetExceeded(budget: BudgetCheckResult, what = "AI"): GatewayError {
  const period = budget.period === "daily" ? "Daily" : "Monthly";
  const subject = budget.scope === "global" ? "AI budget for all accounts" : `${what} budget`;
  return new GatewayError(
    "BUDGET_EXCEEDED",
    `${period} ${subject} reached: $${budget.spentUsd.toFixed(2)} of $${budget.capUsd.toFixed(2)} spent.`,
    false,
  );
}

/** Today's spend across every account, read at most once a minute. */
function globalSpentToday(): Promise<number> {
  const now = Date.now();
  if (globalSpendCache && now < globalSpendCache.expiresAt) return globalSpendCache.spent;
  const { startOfDay } = budgetWindows();
  const spent = spentUsd({ createdAt: { gte: startOfDay } });
  const entry = { spent, expiresAt: now + BUDGET_CACHE_TTL_MS };
  globalSpendCache = entry;
  // A failed read isn't kept, so the next call asks the database again.
  spent.catch(() => {
    if (globalSpendCache === entry) globalSpendCache = null;
  });
  return spent;
}

/**
 * The ceiling across every account (AI_GLOBAL_DAILY_COST_CAP_USD), checked
 * before each account's own caps. Null while it is unset or not reached.
 */
async function checkGlobalBudget(): Promise<BudgetCheckResult | null> {
  if (AI_GLOBAL_DAILY_COST_CAP_USD == null) return null;
  const spent = await globalSpentToday();
  if (spent < AI_GLOBAL_DAILY_COST_CAP_USD) return null;
  return { allowed: false, spentUsd: spent, capUsd: AI_GLOBAL_DAILY_COST_CAP_USD, period: "daily", scope: "global" };
}

async function checkBudget(userId: string): Promise<BudgetCheckResult> {
  const global = await checkGlobalBudget();
  if (global) return global;

  // Return cached result if still fresh
  const cached = budgetCache.get(userId);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const { startOfDay, startOfMonth } = budgetWindows();
  const [daily, monthly] = await Promise.all([
    spentUsd({ userId, createdAt: { gte: startOfDay } }),
    spentUsd({ userId, createdAt: { gte: startOfMonth } }),
  ]);
  const result = budgetResult(daily, AI_DAILY_COST_CAP_USD, monthly);

  budgetCache.set(userId, { result, expiresAt: Date.now() + BUDGET_CACHE_TTL_MS });
  return result;
}

/**
 * Budget for embedding uploaded files: today's embedding spend against
 * AI_DAILY_EMBED_COST_CAP_USD, plus the shared monthly cap. Not cached, so
 * each slice of a large upload sees the spend of the slices before it.
 */
async function checkUploadEmbedBudget(userId: string): Promise<BudgetCheckResult> {
  const global = await checkGlobalBudget();
  if (global) return global;

  const { startOfDay, startOfMonth } = budgetWindows();
  const [daily, monthly] = await Promise.all([
    spentUsd({ userId, task: EMBED_TASK, createdAt: { gte: startOfDay } }),
    spentUsd({ userId, createdAt: { gte: startOfMonth } }),
  ]);
  return budgetResult(daily, AI_DAILY_EMBED_COST_CAP_USD, monthly);
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

/** Drop an entry that no longer parses (best effort). */
function cacheEvict(keyHash: string): void {
  prisma.aiCache.deleteMany({ where: { keyHash } }).catch(() => {
    /* best-effort */
  });
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
    throw new GatewayError("CIRCUIT_OPEN", CIRCUIT_OPEN_MESSAGE, true);
  }

  const { task, model, promptVersion, input, parseOutput } = spec;
  const inputJson = JSON.stringify(input);
  const cacheKey = sha256(JSON.stringify({ task, model, promptVersion, input }));
  const startMs = Date.now();

  // --- Cache check ---
  if (!opts.skipCache) {
    const cached = await cacheGet(cacheKey);
    let cachedOutput: T | undefined;
    let parsed = false;
    if (cached) {
      // An entry written before a parser got stricter can fail to parse.
      // Treat it as a miss, evict it, and ask the provider again.
      try {
        cachedOutput = parseOutput(cached.outputJson);
        parsed = true;
      } catch {
        cacheEvict(cacheKey);
      }
    }
    if (parsed) {
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

      return { output: cachedOutput as T, meta };
    }
  }

  // --- Budget check ---
  if (!opts.skipBudget) {
    const budget = await checkBudget(ctx.userId);
    if (!budget.allowed) throw budgetExceeded(budget);
  }

  // --- Provider call ---
  let usage: AiUsage | undefined;
  let rawOutput: unknown;

  try {
    const prompt = getPrompt(task);
    const systemPrompt = prompt.systemPrompt;
    const userPrompt = prompt.buildUserPrompt(input);
    const result = await ctx.provider.completeJson(systemPrompt, userPrompt, model);
    rawOutput = result.json;
    usage = result.usage;
    recordSuccess();
  } catch (err) {
    recordFailure(err);
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

    // Resending a request the provider refused for its content fails again.
    const retryable = !(err instanceof ProviderRequestError);
    throw new GatewayError("PROVIDER_ERROR", `AI provider failed: ${errorCode}`, retryable);
  }

  const latencyMs = Date.now() - startMs;

  // --- Parse output ---
  let output: T;
  try {
    output = parseOutput(rawOutput);
  } catch (parseErr) {
    await logCall({
      userId: ctx.userId,
      task,
      model,
      promptVersion,
      cacheHit: false,
      latencyMs,
      usage,
      status: "ERROR",
      errorCode: "PARSE_ERROR",
    }).catch(() => {});

    throw new GatewayError(
      "PARSE_ERROR",
      `Failed to parse AI output: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
      true,
    );
  }

  // --- Cache write (fire-and-forget) ---
  if (!opts.skipCache) {
    cacheSet(cacheKey, task, model, promptVersion, sha256(inputJson), rawOutput).catch(() => {});
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
// Embed shortcut (no prompts and no cache: embeddings are stored in the DB)
// ---------------------------------------------------------------------------

export interface EmbedOptions {
  /**
   * The budget the call counts against. "general" (the default, for search
   * and chat queries) is the per-user daily and monthly AI cap every feature
   * shares. "upload" is for background embedding of uploaded files: its own
   * daily cap (AI_DAILY_EMBED_COST_CAP_USD) plus the monthly cap. There is
   * no way to skip the budget, since an upload's size is up to the user.
   */
  budget?: "general" | "upload";
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
    throw new GatewayError("CIRCUIT_OPEN", CIRCUIT_OPEN_MESSAGE, true);
  }

  if (opts.budget === "upload") {
    const budget = await checkUploadEmbedBudget(ctx.userId);
    if (!budget.allowed) throw budgetExceeded(budget, "embedding");
  } else {
    const budget = await checkBudget(ctx.userId);
    if (!budget.allowed) throw budgetExceeded(budget);
  }

  const startMs = Date.now();

  try {
    const result = await ctx.provider.embed(texts, model);
    recordSuccess();

    const latencyMs = Date.now() - startMs;
    await logCall({
      userId: ctx.userId,
      task: EMBED_TASK,
      model,
      promptVersion: "n/a",
      cacheHit: false,
      latencyMs,
      usage: result.usage,
      status: "OK",
    }).catch(() => {});

    return { embeddings: result.embeddings, usage: result.usage };
  } catch (err) {
    recordFailure(err);
    const latencyMs = Date.now() - startMs;
    const errorCode = err instanceof Error ? err.message.slice(0, 100) : "UNKNOWN";

    await logCall({
      userId: ctx.userId,
      task: EMBED_TASK,
      model,
      promptVersion: "n/a",
      cacheHit: false,
      latencyMs,
      status: "ERROR",
      errorCode,
    }).catch(() => {});

    const retryable = !(err instanceof ProviderRequestError);
    throw new GatewayError("PROVIDER_ERROR", `Embedding failed: ${errorCode}`, retryable);
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
