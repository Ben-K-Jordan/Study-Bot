import { describe, it, expect } from "vitest";
import type { NextRequest } from "next/server";
import { getClientIp } from "@/lib/rate-limit";

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
