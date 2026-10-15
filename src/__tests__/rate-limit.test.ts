import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { createRateLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";

function makeRequest(headers: Record<string, string>): NextRequest {
  return new Request("http://localhost/api/test", { headers }) as unknown as NextRequest;
}

describe("getClientIp", () => {
  it("returns the single X-Forwarded-For entry when there is only one", () => {
    const request = makeRequest({ "x-forwarded-for": "203.0.113.7" });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("uses the rightmost X-Forwarded-For entry (appended by the nearest trusted proxy)", () => {
    const request = makeRequest({
      "x-forwarded-for": "198.51.100.1, 203.0.113.7, 192.0.2.44",
    });
    expect(getClientIp(request)).toBe("192.0.2.44");
  });

  it("trims whitespace around the rightmost entry", () => {
    const request = makeRequest({
      "x-forwarded-for": "198.51.100.1,  192.0.2.44  ",
    });
    expect(getClientIp(request)).toBe("192.0.2.44");
  });

  it("ignores attacker-prepended entries so spoofing cannot rotate rate-limit buckets", () => {
    const realIp = "192.0.2.44";
    const spoofed = makeRequest({
      "x-forwarded-for": `evil-${Math.random()}, ${realIp}`,
    });
    const spoofedAgain = makeRequest({
      "x-forwarded-for": `evil-${Math.random()}, ${realIp}`,
    });
    expect(getClientIp(spoofed)).toBe(realIp);
    expect(getClientIp(spoofedAgain)).toBe(realIp);
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    const request = makeRequest({ "x-real-ip": "203.0.113.7" });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to X-Real-IP when X-Forwarded-For has no usable entry", () => {
    const request = makeRequest({
      "x-forwarded-for": "  ",
      "x-real-ip": "203.0.113.7",
    });
    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const request = makeRequest({});
    expect(getClientIp(request)).toBe("unknown");
  });
});

describe("tooManyRequests", () => {
  it("sets Retry-After in whole seconds and says how long to wait by default", async () => {
    const res = tooManyRequests(1500);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("2");
    const body = await res.json();
    expect(body.error).toBe("Too many requests. Retry in 2 seconds.");
    expect(body.code).toBe("RATE_LIMITED");
  });

  it("rounds longer waits up to whole minutes", async () => {
    const res = tooManyRequests(90_000);
    expect((await res.json()).error).toBe("Too many requests. Retry in 2 minutes.");
  });

  it("takes a message that names the limited action", async () => {
    const res = tooManyRequests(60_000, "Too many reset requests. Retry in 1 minute.");
    expect((await res.json()).error).toBe("Too many reset requests. Retry in 1 minute.");
  });
});

describe("createRateLimiter", () => {
  it("allows up to the limit, then reports the wait", () => {
    const limiter = createRateLimiter("test-limit", { maxRequests: 2, windowMs: 60_000 });
    expect(limiter.check("ip").allowed).toBe(true);
    expect(limiter.check("ip").allowed).toBe(true);
    const blocked = limiter.check("ip");
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
    expect(limiter.check("other-ip").allowed).toBe(true);
    limiter.reset();
    expect(limiter.check("ip").allowed).toBe(true);
  });
});
