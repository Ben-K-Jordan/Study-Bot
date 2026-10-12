/**
 * Unit tests for GET /api/integrations/google/callback redirects.
 *
 * Every outcome of the OAuth callback lands back on /settings with a
 * `google` query parameter, and the provider's error value is URL-encoded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    oAuthState: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    googleIntegration: { upsert: vi.fn() },
  },
}));

import { GET } from "@/app/api/integrations/google/callback/route";
import { prisma } from "@/lib/db";

const findState = vi.mocked(prisma.oAuthState.findUnique);

function callback(query: string): NextRequest {
  return new Request(
    `http://localhost:3000/api/integrations/google/callback${query}`,
  ) as unknown as NextRequest;
}

function location(res: Response): URL {
  return new URL(res.headers.get("location") ?? "");
}

describe("GET /api/integrations/google/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BASE_URL", "http://localhost:3000");
  });

  it("redirects provider errors to /settings with the reason encoded", async () => {
    const res = await GET(callback("?error=access_denied%26x%3D1"));
    expect(res.status).toBe(302);
    const url = location(res);
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("google")).toBe("error");
    expect(url.searchParams.get("reason")).toBe("access_denied&x=1");
    expect(url.searchParams.has("x")).toBe(false);
  });

  it("redirects to /settings when code or state is missing", async () => {
    const url = location(await GET(callback("?code=abc")));
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("reason")).toBe("missing_params");
    expect(findState).not.toHaveBeenCalled();
  });

  it("redirects to /settings when the state is unknown", async () => {
    findState.mockResolvedValue(null);
    const url = location(await GET(callback("?code=abc&state=nope")));
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("google")).toBe("error");
    expect(url.searchParams.get("reason")).toBe("invalid_state");
  });
});
