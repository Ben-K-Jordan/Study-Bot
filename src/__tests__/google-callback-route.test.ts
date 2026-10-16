/**
 * Unit tests for GET /api/integrations/google/callback redirects.
 *
 * Every outcome of the OAuth callback lands back on /settings with a
 * `google` query parameter, and the provider's error value is URL-encoded.
 * The tokens are stored for the signed-in user, and only when the state was
 * issued to that same user.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    oAuthState: { deleteMany: vi.fn() },
    googleIntegration: { upsert: vi.fn() },
  },
}));

vi.mock("@/lib/auth", () => ({ getUserId: vi.fn() }));

import { GET } from "@/app/api/integrations/google/callback/route";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

const claimState = vi.mocked(prisma.oAuthState.deleteMany);
const upsert = vi.mocked(prisma.googleIntegration.upsert);
const sessionUser = vi.mocked(getUserId);

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
    vi.unstubAllGlobals();
    vi.stubEnv("BASE_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "client-secret");
    vi.stubEnv("TOKEN_ENC_KEY", "a".repeat(64));
    sessionUser.mockResolvedValue("user-b");
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
    expect(claimState).not.toHaveBeenCalled();
  });

  it("redirects to /settings when the state is unknown", async () => {
    claimState.mockResolvedValue({ count: 0 });
    const url = location(await GET(callback("?code=abc&state=nope")));
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("google")).toBe("error");
    expect(url.searchParams.get("reason")).toBe("invalid_state");
  });

  it("rejects a callback with no signed-in user before touching the state", async () => {
    sessionUser.mockResolvedValue(null);
    const url = location(await GET(callback("?code=abc&state=s1")));
    expect(url.searchParams.get("reason")).toBe("invalid_state");
    expect(claimState).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("claims the state only for the signed-in user, unexpired, in one statement", async () => {
    claimState.mockResolvedValue({ count: 0 });
    await GET(callback("?code=abc&state=s1"));
    expect(claimState).toHaveBeenCalledTimes(1);
    const where = claimState.mock.calls[0][0]?.where;
    expect(where).toMatchObject({ state: "s1", userId: "user-b" });
    expect(where?.expiresAt).toEqual({ gt: expect.any(Date) });
  });

  it("refuses user A's state in user B's session and stores no tokens", async () => {
    // State "a-state" was issued to user-a; the claim scoped to user-b finds nothing.
    claimState.mockImplementation((async (args: { where: { userId: string } }) => ({
      count: args.where.userId === "user-a" ? 1 : 0,
    })) as never);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const url = location(await GET(callback("?code=victim-code&state=a-state")));
    expect(url.searchParams.get("reason")).toBe("invalid_state");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("stores the tokens under the signed-in user once the state is claimed", async () => {
    claimState.mockResolvedValue({ count: 1 });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) =>
        String(input).includes("/token")
          ? Response.json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "s" })
          : Response.json({ email: "b@example.com" }),
      ),
    );

    const url = location(await GET(callback("?code=abc&state=s1")));
    expect(url.searchParams.get("google")).toBe("connected");
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0];
    expect(args.where).toEqual({ userId: "user-b" });
    expect(args.create).toMatchObject({ userId: "user-b", connectedEmail: "b@example.com" });
  });
});
