/**
 * In-memory sliding-window rate limiter.
 *
 * Each limiter tracks hits per key (usually IP or userId) within a time window.
 * Expired entries are lazily cleaned up on every check().
 *
 * NOTE: This is per-process. In a multi-instance deployment, replace with
 * Redis-backed rate limiting (e.g. @upstash/ratelimit).
 */

interface RateLimitEntry {
  timestamps: number[];
}

interface RateLimitConfig {
  /** Maximum requests allowed within the window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
}

const stores = new Map<string, Map<string, RateLimitEntry>>();

function getStore(name: string): Map<string, RateLimitEntry> {
  let store = stores.get(name);
  if (!store) {
    store = new Map();
    stores.set(name, store);
  }
  return store;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

/**
 * Create a named rate limiter with the given config.
 *
 * Usage:
 *   const limiter = createRateLimiter("auth", { maxRequests: 5, windowMs: 15 * 60 * 1000 });
 *   const result = limiter.check(ip);
 *   if (!result.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 */
export function createRateLimiter(name: string, config: RateLimitConfig) {
  const store = getStore(name);

  return {
    check(key: string): RateLimitResult {
      const now = Date.now();
      const windowStart = now - config.windowMs;

      let entry = store.get(key);
      if (!entry) {
        entry = { timestamps: [] };
        store.set(key, entry);
      }

      // Purge timestamps outside the window
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

      if (entry.timestamps.length >= config.maxRequests) {
        const oldestInWindow = entry.timestamps[0];
        const retryAfterMs = oldestInWindow + config.windowMs - now;
        return {
          allowed: false,
          remaining: 0,
          retryAfterMs: Math.max(retryAfterMs, 0),
        };
      }

      entry.timestamps.push(now);
      return {
        allowed: true,
        remaining: config.maxRequests - entry.timestamps.length,
        retryAfterMs: 0,
      };
    },

    /** Manually clear all entries (useful for testing) */
    reset() {
      store.clear();
    },
  };
}

// ── Pre-configured limiters ──────────────────────────────────────────────────

// A development server sees every browser, test run and screenshot harness on
// the machine as one client ("unknown" IP), so the auth limits there are
// loose enough not to lock the developer out. Production keeps the real ones.
const isProduction = process.env.NODE_ENV === "production";

/**
 * Sign-in: 10 attempts per 15 minutes per IP (every next-auth POST, which
 * includes sign-out). Used by /api/auth/[...nextauth].
 */
export const authLimiter = createRateLimiter("auth", {
  maxRequests: isProduction ? 10 : 100,
  windowMs: 15 * 60 * 1000,
});

/**
 * Auth emails (password reset links, verification links): 10 per 15 minutes
 * per IP. Kept apart from sign-in so asking for a link doesn't use up
 * sign-in attempts.
 */
export const authEmailLimiter = createRateLimiter("auth-email", {
  maxRequests: isProduction ? 10 : 100,
  windowMs: 15 * 60 * 1000,
});

/** Using an emailed link (reset password, verify email): 10 per 15 minutes per IP. */
export const authTokenLimiter = createRateLimiter("auth-token", {
  maxRequests: isProduction ? 10 : 100,
  windowMs: 15 * 60 * 1000,
});

/** Signup: 3 accounts per hour per IP */
export const signupLimiter = createRateLimiter("signup", {
  maxRequests: isProduction ? 3 : 30,
  windowMs: 60 * 60 * 1000,
});

/** Chat messages: 30 per minute per user */
export const chatLimiter = createRateLimiter("chat", {
  maxRequests: 30,
  windowMs: 60 * 1000,
});

/** AI-intensive endpoints (flashcard gen, document processing): 5 per minute per user */
export const aiLimiter = createRateLimiter("ai", {
  maxRequests: 5,
  windowMs: 60 * 1000,
});

/** General API: 120 requests per minute per user */
export const generalLimiter = createRateLimiter("general", {
  maxRequests: 120,
  windowMs: 60 * 1000,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { retryAfterText } from "@/lib/format";

/**
 * How many reverse proxies in front of the app append to X-Forwarded-For
 * (TRUSTED_PROXY_HOPS, default 1). Each appends the address it saw, so the
 * client's real address is that many entries from the right; everything to
 * its left was sent by the client and can be anything.
 */
function trustedProxyHops(): number {
  const hops = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

/**
 * Extract a rate-limit key from a request (IP or forwarded-for). Production
 * must run behind a reverse proxy that appends X-Forwarded-For: Next fills
 * the header only when the client sent none, so without a proxy the value is
 * whatever the client chose.
 */
export function getClientIp(request: Pick<Request, "headers">): string {
  // Count TRUSTED_PROXY_HOPS entries from the right: those were appended by
  // the proxies. Entries further left are client-supplied, so an attacker
  // could prepend arbitrary values to rotate rate-limit buckets.
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const entries = forwardedFor.split(",").map((entry) => entry.trim());
    const hops = trustedProxyHops();
    // A shorter header than expected: the leftmost entry is still the one
    // the outermost proxy saw.
    const index = Math.max(0, entries.length - hops);
    const client = entries[index];
    if (client) return client;
  }
  return request.headers.get("x-real-ip") || "unknown";
}

/**
 * Return a 429 response with a Retry-After header. The default text says how
 * long to wait; `message` replaces it for callers that can say which action
 * was limited.
 */
export function tooManyRequests(retryAfterMs: number, message?: string): NextResponse {
  const retryAfterSec = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return NextResponse.json(
    { error: message ?? `Too many requests. ${retryAfterText(retryAfterSec)}`, code: "RATE_LIMITED" },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSec) },
    },
  );
}

// ── Periodic cleanup (prevent memory leaks in long-running processes) ────────

const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [, store] of stores) {
      for (const [key, entry] of store) {
        entry.timestamps = entry.timestamps.filter(
          (t) => now - t < 60 * 60 * 1000, // keep at most 1 hour
        );
        if (entry.timestamps.length === 0) {
          store.delete(key);
        }
      }
    }
  }, CLEANUP_INTERVAL);
  // Don't prevent process exit
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    cleanupTimer.unref();
  }
}

startCleanup();
