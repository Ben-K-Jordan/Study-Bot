/**
 * GET /api/integrations/google/connect: signed-out students go to sign-in,
 * the fake provider connects straight away (no real consent page), and the
 * real flow stores a state for this student before sending them to Google.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  prisma: {
    oAuthState: { deleteMany: vi.fn(async () => ({ count: 0 })), create: vi.fn(async () => ({})) },
    googleIntegration: { upsert: vi.fn(async () => ({})) },
  },
}));

vi.mock("@/lib/auth", () => ({ getUserId: vi.fn() }));

import { GET } from "@/app/api/integrations/google/connect/route";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

const sessionUser = vi.mocked(getUserId);
const createState = vi.mocked(prisma.oAuthState.create);
const upsert = vi.mocked(prisma.googleIntegration.upsert);

function connect(): NextRequest {
  return new Request("http://localhost:3000/api/integrations/google/connect") as unknown as NextRequest;
}

function location(res: Response): URL {
  return new URL(res.headers.get("location") ?? "");
}

describe("GET /api/integrations/google/connect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BASE_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
    vi.stubEnv("GOOGLE_PROVIDER", "real");
    sessionUser.mockResolvedValue("user-a");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("sends a signed-out visitor to sign in, back to the calendar section", async () => {
    sessionUser.mockResolvedValue(null);
    const url = location(await GET(connect()));
    expect(url.pathname).toBe("/auth/signin");
    expect(url.searchParams.get("callbackUrl")).toBe("/settings#calendar");
    expect(createState).not.toHaveBeenCalled();
  });

  it("connects the fake calendar directly instead of opening Google's consent page", async () => {
    vi.stubEnv("GOOGLE_PROVIDER", "fake");
    const res = await GET(connect());
    const url = location(res);
    expect(url.origin).toBe("http://localhost:3000");
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("google")).toBe("connected");
    expect(upsert).toHaveBeenCalledTimes(1);
    const args = upsert.mock.calls[0][0] as { where: unknown; create: Record<string, unknown> };
    expect(args.where).toEqual({ userId: "user-a" });
    expect(args.create).toMatchObject({ userId: "user-a", status: "CONNECTED" });
    expect(createState).not.toHaveBeenCalled();
  });

  it("stores a state for the signed-in student and redirects to Google", async () => {
    const url = location(await GET(connect()));
    expect(url.origin).toBe("https://accounts.google.com");
    const state = url.searchParams.get("state");
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    expect(createState).toHaveBeenCalledWith({
      data: { state, userId: "user-a", expiresAt: expect.any(Date) },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("goes back to Settings with a reason when Google isn't configured", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    const url = location(await GET(connect()));
    expect(url.pathname).toBe("/settings");
    expect(url.searchParams.get("reason")).toBe("not_configured");
  });
});
