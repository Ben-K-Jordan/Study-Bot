/**
 * POST /api/integrations/google/disconnect: revokes the grant at Google with
 * the refresh token (the access token has usually expired), with a timeout,
 * then clears the stored tokens even when the revoke fails.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/lib/crypto/token-vault", () => ({
  decryptToken: vi.fn((value: string) => `plain-${value}`),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    googleIntegration: { findUnique: vi.fn(), update: vi.fn(async () => ({})) },
  },
}));

import { POST } from "@/app/api/integrations/google/disconnect/route";
import { prisma } from "@/lib/db";

const findIntegration = vi.mocked(prisma.googleIntegration.findUnique);
const updateIntegration = vi.mocked(prisma.googleIntegration.update);

function request(userId: string | null = "u1"): NextRequest {
  return new Request("http://localhost:3000/api/integrations/google/disconnect", {
    method: "POST",
    headers: userId ? { "x-user-id": userId } : {},
  }) as unknown as NextRequest;
}

describe("POST /api/integrations/google/disconnect", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers 401 when signed out", async () => {
    expect((await POST(request(null))).status).toBe(401);
    expect(findIntegration).not.toHaveBeenCalled();
  });

  it("revokes the refresh token, not the expired access token, with a timeout", async () => {
    findIntegration.mockResolvedValue({ id: "g1", accessTokenEncrypted: "a", refreshTokenEncrypted: "r" } as never);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=plain-r");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(updateIntegration).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: expect.objectContaining({
        status: "DISCONNECTED",
        accessTokenEncrypted: null,
        refreshTokenEncrypted: null,
      }),
    });
  });

  it("falls back to the access token when there is no refresh token", async () => {
    findIntegration.mockResolvedValue({ id: "g1", accessTokenEncrypted: "a", refreshTokenEncrypted: null } as never);
    await POST(request());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(String(init.body)).toBe("token=plain-a");
  });

  it("still clears the tokens when the revoke fails", async () => {
    findIntegration.mockResolvedValue({ id: "g1", accessTokenEncrypted: null, refreshTokenEncrypted: "r" } as never);
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ disconnected: true, status: "DISCONNECTED" });
    expect(updateIntegration).toHaveBeenCalledTimes(1);
  });

  it("answers disconnected without calling Google when nothing is connected", async () => {
    findIntegration.mockResolvedValue(null);
    const res = await POST(request());
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateIntegration).not.toHaveBeenCalled();
  });
});
