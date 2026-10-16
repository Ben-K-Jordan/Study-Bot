/**
 * Unit tests for the static security headers in next.config.js, mainly the
 * baseline Content-Security-Policy every response gets.
 */
import { createRequire } from "node:module";
import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const CONFIG_PATH = require.resolve("../../next.config.js");

/** Loads next.config.js fresh, since it reads NODE_ENV when it is required. */
async function loadHeaders(nodeEnv: string): Promise<Map<string, string>> {
  vi.stubEnv("NODE_ENV", nodeEnv);
  delete require.cache[CONFIG_PATH];
  const config = require(CONFIG_PATH) as NextConfig;
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === "/:path*");
  return new Map((all?.headers ?? []).map((h) => [h.key, h.value]));
}

/** Splits a policy into directive name and its sources. */
async function loadCsp(nodeEnv: string): Promise<Map<string, string[]>> {
  const policy = (await loadHeaders(nodeEnv)).get("Content-Security-Policy") ?? "";
  return new Map(
    policy.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
  delete require.cache[CONFIG_PATH];
});

describe("next.config.js Content-Security-Policy", () => {
  it("keeps every connection same-origin", async () => {
    const csp = await loadCsp("production");
    expect(csp.get("connect-src")).toEqual(["'self'"]);
  });

  it("names no other origin in any directive", async () => {
    const csp = await loadCsp("production");
    const sources = [...csp.values()].flat();
    expect(sources.filter((s) => /^(https?:|wss?:|\*)/.test(s) || s.includes("."))).toEqual([]);
  });

  it("allows eval only under next dev", async () => {
    expect((await loadCsp("production")).get("script-src")).not.toContain("'unsafe-eval'");
    expect((await loadCsp("development")).get("script-src")).toContain("'unsafe-eval'");
  });

  it("blocks plugins, framing, base rewrites and off-site form posts", async () => {
    const csp = await loadCsp("production");
    expect(csp.get("object-src")).toEqual(["'none'"]);
    expect(csp.get("frame-ancestors")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'self'"]);
    expect(csp.get("form-action")).toEqual(["'self'"]);
  });
});

describe("next.config.js security headers", () => {
  it("sends the clickjacking and sniffing headers", async () => {
    const headers = await loadHeaders("production");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
