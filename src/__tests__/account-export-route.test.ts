/**
 * GET /api/account/export: BigInt columns serialize, and the route has its
 * own rate limit with a readable 429.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

// Every model answers empty, except the two with BigInt columns.
vi.mock("@/lib/db", () => {
  const model = (overrides: Record<string, unknown> = {}) => ({
    findMany: vi.fn(async () => []),
    findUnique: vi.fn(async () => null),
    ...overrides,
  });
  const prisma = new Proxy(
    {
      aiCallLog: model({
        findMany: vi.fn(async () => [{ id: "a1", costUsdMicros: BigInt("12345678901234567") }]),
      }),
      googleIntegration: model({
        findUnique: vi.fn(async () => ({ id: "g1", tokenExpiryMs: BigInt(42) })),
      }),
    } as Record<string, unknown>,
    {
      get(target, key: string) {
        if (!(key in target)) target[key] = model();
        return target[key];
      },
    },
  );
  return { prisma };
});

import { GET } from "@/app/api/account/export/route";

function request(userId: string | null): NextRequest {
  return new Request("http://localhost:3000/api/account/export", {
    headers: userId ? { "x-user-id": userId } : {},
  }) as unknown as NextRequest;
}

describe("GET /api/account/export", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exports BigInt columns as strings in a JSON attachment", async () => {
    const res = await GET(request("export-user-1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="study-bot-export-\d+\.json"$/);
    const body = JSON.parse(await res.text());
    expect(body.aiCallLogs[0].costUsdMicros).toBe("12345678901234567");
    expect(body.googleIntegration.tokenExpiryMs).toBe("42");
  });

  it("allows 3 exports a minute, then answers 429 with a wait in seconds", async () => {
    for (let i = 0; i < 3; i++) expect((await GET(request("export-user-2"))).status).toBe(200);
    const limited = await GET(request("export-user-2"));
    expect(limited.status).toBe(429);
    const body = await limited.json();
    expect(body.error).toMatch(/^Too many exports\. Retry in \d+ seconds?\.$/);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("answers 401 when signed out", async () => {
    expect((await GET(request(null))).status).toBe(401);
  });
});
