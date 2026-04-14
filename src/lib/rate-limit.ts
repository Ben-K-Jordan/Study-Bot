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

/** Auth endpoints: 10 attempts per 15 minutes per IP */
export const authLimiter = createRateLimiter("auth", {
  maxRequests: 10,
  windowMs: 15 * 60 * 1000,
});

/** Signup: 3 accounts per hour per IP */
export const signupLimiter = createRateLimiter("signup", {
  maxRequests: 3,
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

/** Push subscribe: 10 per hour per user */
export const pushLimiter = createRateLimiter("push", {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

/** General API: 120 requests per minute per user */
export const generalLimiter = createRateLimiter("general", {
  maxRequests: 120,
  windowMs: 60 * 1000,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";

/** Extract a rate-limit key from a request (IP or forwarded-for) */
export function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

/** Return a 429 response with Retry-After header */
export function tooManyRequests(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
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
