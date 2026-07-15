/**
 * Unit tests for the GET feedback route status mapping:
 * PENDING -> 200 with { status: "PENDING", excerpts: [] } (clients poll),
 * NOT_FOUND -> 404, service throw -> 500.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/services/feedback", () => ({
  generateFeedback: vi.fn(),
}));

import { GET } from "@/app/api/attempts/[attemptId]/feedback/route";
import { generateFeedback } from "@/services/feedback";

const generateFeedbackMock = vi.mocked(generateFeedback);

function makeRequest(userId: string | null = "user-1"): NextRequest {
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  return new Request("http://localhost/api/attempts/attempt-1/feedback", {
    headers,
  }) as unknown as NextRequest;
}

const PARAMS = { params: { attemptId: "attempt-1" } };

describe("GET /api/attempts/[attemptId]/feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a user", async () => {
    const res = await GET(makeRequest(null), PARAMS);
    expect(res.status).toBe(401);
  });

  it("maps PENDING to HTTP 200 with a poll-friendly body", async () => {
    generateFeedbackMock.mockResolvedValue({ status: "PENDING", excerpts: [] });

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "PENDING", excerpts: [] });
  });

  it("maps NOT_FOUND to 404", async () => {
    generateFeedbackMock.mockResolvedValue({ status: "NOT_FOUND", excerpts: [] });

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(404);
  });

  it("returns the full feedback payload for OK", async () => {
    const payload = {
      status: "OK" as const,
      excerpts: [],
      explanation: "because osmosis",
      socratic_followup: "why?",
    };
    generateFeedbackMock.mockResolvedValue(payload);

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(payload);
  });

  it("returns 500 when the service throws", async () => {
    generateFeedbackMock.mockRejectedValue(new Error("boom"));

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
