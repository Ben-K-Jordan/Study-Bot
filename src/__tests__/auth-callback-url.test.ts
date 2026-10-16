import { describe, it, expect } from "vitest";
import { safeCallbackUrl, withCallbackUrl } from "@/components/auth/callback-url";

describe("safeCallbackUrl", () => {
  it("keeps same-origin paths with their query and hash", () => {
    expect(safeCallbackUrl("/plan")).toBe("/plan");
    expect(safeCallbackUrl("/plan?range=all#today")).toBe("/plan?range=all#today");
    expect(safeCallbackUrl("/s/abc123")).toBe("/s/abc123");
    expect(safeCallbackUrl(["/learn", "/plan"])).toBe("/learn");
  });

  it("falls back to Home for anything missing or not a string", () => {
    expect(safeCallbackUrl(undefined)).toBe("/");
    expect(safeCallbackUrl(null)).toBe("/");
    expect(safeCallbackUrl("")).toBe("/");
    expect(safeCallbackUrl(42)).toBe("/");
    expect(safeCallbackUrl([])).toBe("/");
  });

  it("rejects other origins and protocol tricks", () => {
    const attempts = [
      "https://evil.example/plan",
      "//evil.example/plan",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "http:evil.example",
      "plan",
      "/plan\nLocation: https://evil.example",
      "/\tevil",
    ];
    for (const raw of attempts) {
      expect(safeCallbackUrl(raw), raw).toBe("/");
    }
  });

  it("keeps encoded characters encoded", () => {
    expect(safeCallbackUrl("/%0d%0aSet-Cookie:x")).toBe("/%0d%0aSet-Cookie:x");
  });

  it("never sends someone back to an auth screen or an API route", () => {
    expect(safeCallbackUrl("/auth/signin")).toBe("/");
    expect(safeCallbackUrl("/auth/signin?callbackUrl=%2Fauth%2Fsignin")).toBe("/");
    expect(safeCallbackUrl("/api/auth/signout")).toBe("/");
    expect(safeCallbackUrl("/auth")).toBe("/");
    expect(safeCallbackUrl("/authors")).toBe("/authors");
  });

  it("rejects absurdly long values", () => {
    expect(safeCallbackUrl(`/${"a".repeat(3000)}`)).toBe("/");
  });
});

describe("withCallbackUrl", () => {
  it("leaves the default destination off", () => {
    expect(withCallbackUrl("/auth/signup", "/")).toBe("/auth/signup");
  });

  it("appends an encoded callback URL", () => {
    expect(withCallbackUrl("/auth/signup", "/plan?range=all")).toBe(
      "/auth/signup?callbackUrl=%2Fplan%3Frange%3Dall",
    );
    expect(withCallbackUrl("/auth/signin?verified=true", "/plan")).toBe(
      "/auth/signin?verified=true&callbackUrl=%2Fplan",
    );
  });
});
