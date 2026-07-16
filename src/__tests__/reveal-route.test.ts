/**
 * Unit tests for GET /api/runs/[runId]/reveal — the answer-standard reveal
 * used at self-score time for free-recall prompts.
 *
 * Contract: authenticated owner only, index validated, service errors map to
 * 404/403/409, and the model_answer/key_points payload passes through for
 * the happy path (the MCQ pre-answer guard lives in the service and returns
 * a null payload — never the answer key).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/services/run", () => ({
  getAnswerReveal: vi.fn(),
}));

import { GET } from "@/app/api/runs/[runId]/reveal/route";
import { getAnswerReveal } from "@/services/run";

const getAnswerRevealMock = vi.mocked(getAnswerReveal);

function makeRequest(index: string | null = "0", userId: string | null = "user-1"): NextRequest {
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  const qs = index === null ? "" : `?index=${index}`;
  return new Request(`http://localhost/api/runs/run-1/reveal${qs}`, {
    headers,
  }) as unknown as NextRequest;
}

const PARAMS = { params: { runId: "run-1" } };

describe("GET /api/runs/[runId]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a user", async () => {
    const res = await GET(makeRequest("0", null), PARAMS);
    expect(res.status).toBe(401);
    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing or negative index", async () => {
    expect((await GET(makeRequest(null), PARAMS)).status).toBe(400);
    expect((await GET(makeRequest("-1"), PARAMS)).status).toBe(400);
    expect((await GET(makeRequest("abc"), PARAMS)).status).toBe(400);
    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("maps not_found to 404 and forbidden to 403", async () => {
    getAnswerRevealMock.mockResolvedValue({ error: "not_found" });
    expect((await GET(makeRequest(), PARAMS)).status).toBe(404);

    getAnswerRevealMock.mockResolvedValue({ error: "forbidden" });
    expect((await GET(makeRequest(), PARAMS)).status).toBe(403);
  });

  it("maps wrong_phase (EXAM) and wrong_index to 409", async () => {
    getAnswerRevealMock.mockResolvedValue({
      error: "wrong_phase",
      message: "Answers are revealed after the exam phase",
    });
    expect((await GET(makeRequest(), PARAMS)).status).toBe(409);

    getAnswerRevealMock.mockResolvedValue({ error: "wrong_index", expected: 2 });
    const res = await GET(makeRequest("5"), PARAMS);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Wrong prompt index", expected: 2 });
  });

  it("returns model_answer and key_points for the authenticated owner", async () => {
    getAnswerRevealMock.mockResolvedValue({
      data: { model_answer: "Water moves toward solute.", key_points: ["gradient", "membrane"] },
    });

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      model_answer: "Water moves toward solute.",
      key_points: ["gradient", "membrane"],
    });
    expect(getAnswerRevealMock).toHaveBeenCalledWith("user-1", "run-1", 0);
  });

  it("passes through a graceful-absence payload (prompt without key points)", async () => {
    getAnswerRevealMock.mockResolvedValue({
      data: { model_answer: null, key_points: null },
    });

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ model_answer: null, key_points: null });
  });

  it("returns 500 when the service throws", async () => {
    getAnswerRevealMock.mockRejectedValue(new Error("boom"));

    const res = await GET(makeRequest(), PARAMS);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
