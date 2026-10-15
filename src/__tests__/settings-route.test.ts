/**
 * GET and PUT /api/settings: defaults without writes, merged validation,
 * field errors instead of "Validation failed".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    userGameState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { GET, PUT } from "@/app/api/settings/route";
import { SETTINGS_FIELD_MESSAGES } from "@/app/api/settings/schema";
import { prisma } from "@/lib/db";

const findState = vi.mocked(prisma.userGameState.findUnique);
const upsertState = vi.mocked(prisma.userGameState.upsert);
const createState = vi.mocked(prisma.userGameState.create);

const STORED = {
  studyStartTime: "14:00",
  studyEndTime: "22:00",
  dailyStudyCap: 120,
  dailyXpGoal: 50,
  timezone: "America/New_York",
};

function request(method: string, body?: unknown, userId: string | null = "u1"): NextRequest {
  return new Request("http://localhost:3000/api/settings", {
    method,
    headers: {
      ...(userId ? { "x-user-id": userId } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("/api/settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id");
  });

  it("answers 401 with a sentence when signed out", async () => {
    const res = await GET(request("GET", undefined, null));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Your sign-in expired. Sign in again.");
  });

  it("returns defaults for a student with no row, without creating one", async () => {
    findState.mockResolvedValue(null);
    const res = await GET(request("GET"));
    expect(await res.json()).toEqual({
      studyStart: "09:00",
      studyEnd: "17:00",
      dailyCap: 180,
      dailyXpGoal: 50,
      timezone: null,
      google_configured: true,
    });
    expect(createState).not.toHaveBeenCalled();
    expect(upsertState).not.toHaveBeenCalled();
  });

  it("returns 500 with a retry sentence when the read fails", async () => {
    findState.mockRejectedValue(new Error("db down"));
    const res = await GET(request("GET"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Settings didn't load. Retry.");
  });

  it("saves a valid update and returns the saved settings", async () => {
    findState.mockResolvedValue(STORED as never);
    upsertState.mockImplementation((async ({ update }: { update: Record<string, unknown> }) => ({
      ...STORED,
      ...update,
    })) as never);
    const res = await PUT(request("PUT", { dailyXpGoal: 100, timezone: "Europe/Paris" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      studyStart: "14:00",
      studyEnd: "22:00",
      dailyCap: 120,
      dailyXpGoal: 100,
      timezone: "Europe/Paris",
    });
  });

  it("rejects an end time before the saved start time, per field", async () => {
    findState.mockResolvedValue(STORED as never);
    const res = await PUT(request("PUT", { studyEnd: "13:00" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Settings not saved. Check the highlighted fields.");
    expect(body.fields).toEqual({ studyEnd: SETTINGS_FIELD_MESSAGES.studyOrder });
    expect(upsertState).not.toHaveBeenCalled();
  });

  it("maps schema failures and unknown zones to field messages", async () => {
    findState.mockResolvedValue(STORED as never);
    const bad = await PUT(request("PUT", { studyStart: "", dailyCap: 5 }));
    expect((await bad.json()).fields).toEqual({
      studyStart: SETTINGS_FIELD_MESSAGES.studyStart,
      dailyCap: SETTINGS_FIELD_MESSAGES.dailyCap,
    });
    const zone = await PUT(request("PUT", { timezone: "Not/AZone" }));
    expect(zone.status).toBe(400);
    expect((await zone.json()).fields).toEqual({ timezone: SETTINGS_FIELD_MESSAGES.timezone });
  });

  it("clears the zone with an empty string", async () => {
    findState.mockResolvedValue(STORED as never);
    upsertState.mockImplementation((async ({ update }: { update: Record<string, unknown> }) => ({
      ...STORED,
      ...update,
    })) as never);
    const res = await PUT(request("PUT", { timezone: "" }));
    expect((await res.json()).timezone).toBeNull();
  });

  it("rejects a body that isn't JSON without a raw message", async () => {
    const res = await PUT(request("PUT", "{nope"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Settings not saved. Retry.");
  });
});
