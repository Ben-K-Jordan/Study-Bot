/**
 * Unit tests for the request proxy (src/proxy.ts): which paths skip auth,
 * when the test-auth header is trusted, and cross-site write rejection.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

import { getToken } from "next-auth/jwt";
import { proxy } from "@/proxy";
import { isTestAuthEnabled, testAuthUserId } from "@/lib/test-auth";

const getTokenMock = vi.mocked(getToken);

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: init.method ?? "GET",
    headers: { host: "localhost:3000", ...init.headers },
  });
}

/** "pass" when the proxy lets the request through, else the status code. */
async function outcome(request: NextRequest): Promise<"pass" | number> {
  const res = await proxy(request);
  return res.headers.get("x-middleware-next") === "1" ? "pass" : res.status;
}

beforeEach(() => {
  getTokenMock.mockReset();
  getTokenMock.mockResolvedValue(null);
  vi.stubEnv("ALLOW_TEST_AUTH", "");
  vi.stubEnv("CI", "");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test-auth gate", () => {
  it("is off unless ALLOW_TEST_AUTH=true", () => {
    expect(isTestAuthEnabled()).toBe(false);
    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    expect(isTestAuthEnabled()).toBe(true);
  });

  it("is off in production builds unless CI=true", () => {
    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(isTestAuthEnabled()).toBe(false);
    vi.stubEnv("CI", "true");
    expect(isTestAuthEnabled()).toBe(true);
  });

  it("reads the first value of a duplicated header", () => {
    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    expect(testAuthUserId(new Headers({ "x-user-id": "u1, u1" }))).toBe("u1");
    expect(testAuthUserId(new Headers())).toBeNull();
  });
});

describe("proxy auth", () => {
  it("redirects signed-out page requests to sign in", async () => {
    const res = await proxy(req("/plan"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/auth/signin?callbackUrl=%2Fplan");
  });

  it("requires sign-in for session pages", async () => {
    expect(await outcome(req("/s/abc123"))).toBe(307);
  });

  it("answers 401 for signed-out API requests", async () => {
    expect(await outcome(req("/api/plans"))).toBe(401);
  });

  it("lets public paths and static files through", async () => {
    expect(await outcome(req("/auth/signin"))).toBe("pass");
    expect(await outcome(req("/api/health"))).toBe("pass");
    expect(await outcome(req("/manifest.json"))).toBe("pass");
    expect(await outcome(req("/icon.svg"))).toBe("pass");
  });

  it("does not treat a dotted API path or page path as a static file", async () => {
    expect(await outcome(req("/api/plans/x.json"))).toBe(401);
    expect(await outcome(req("/settings.bak"))).toBe(307);
    expect(await outcome(req("/api/healthcheck"))).toBe(401);
  });

  it("lets signed-in requests through", async () => {
    getTokenMock.mockResolvedValue({ sub: "u1" });
    expect(await outcome(req("/api/plans"))).toBe("pass");
    expect(await outcome(req("/s/abc123"))).toBe("pass");
  });

  it("ignores the X-User-Id header unless test auth is enabled", async () => {
    const withHeader = { headers: { "x-user-id": "u1" } };
    expect(await outcome(req("/api/plans", withHeader))).toBe(401);

    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    expect(await outcome(req("/api/plans", withHeader))).toBe("pass");

    vi.stubEnv("NODE_ENV", "production");
    expect(await outcome(req("/api/plans", withHeader))).toBe(401);
  });
});

describe("cross-site writes", () => {
  beforeEach(() => {
    getTokenMock.mockResolvedValue({ sub: "u1" });
  });

  it("rejects API writes from another origin", async () => {
    const res = await proxy(
      req("/api/plans", { method: "POST", headers: { origin: "https://evil.example" } }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects an opaque origin and cross-site fetch metadata", async () => {
    expect(await outcome(req("/api/plans", { method: "POST", headers: { origin: "null" } }))).toBe(403);
    expect(
      await outcome(req("/api/plans", { method: "DELETE", headers: { "sec-fetch-site": "cross-site" } })),
    ).toBe(403);
  });

  it("covers the public auth endpoints too", async () => {
    expect(
      await outcome(req("/api/auth/signup", { method: "POST", headers: { origin: "https://evil.example" } })),
    ).toBe(403);
  });

  it("allows same-origin writes, writes without an Origin, and reads", async () => {
    expect(
      await outcome(req("/api/plans", { method: "POST", headers: { origin: "http://localhost:3000" } })),
    ).toBe("pass");
    expect(await outcome(req("/api/plans", { method: "POST" }))).toBe("pass");
    expect(await outcome(req("/api/plans", { headers: { origin: "https://evil.example" } }))).toBe("pass");
  });

  it("allows the configured BASE_URL origin behind a proxy", async () => {
    vi.stubEnv("BASE_URL", "https://study.example.edu");
    const request = req("/api/plans", {
      method: "PUT",
      headers: { origin: "https://study.example.edu", host: "127.0.0.1:3000" },
    });
    expect(await outcome(request)).toBe("pass");
  });
});
