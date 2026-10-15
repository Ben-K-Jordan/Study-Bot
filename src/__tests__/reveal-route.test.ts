/**
 * Unit tests for /api/runs/[runId]/reveal, the model answer shown at
 * self-score time.
 *
 * Contract: authenticated owner only, index and answer validated, service
 * errors map to 404/403/409 with readable messages, GET passes the index
 * only (it can never commit an answer), and POST passes the student's
 * answer so the service can commit it before revealing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/services/run", () => ({
  getAnswerReveal: vi.fn(),
}));

import { GET, POST } from "@/app/api/runs/[runId]/reveal/route";
import { getAnswerReveal } from "@/services/run";

const getAnswerRevealMock = vi.mocked(getAnswerReveal);

function makeGet(index: string | null = "0", userId: string | null = "user-1"): NextRequest {
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  const qs = index === null ? "" : `?index=${index}`;
  return new Request(`http://localhost/api/runs/run-1/reveal${qs}`, {
    headers,
  }) as unknown as NextRequest;
}

function makePost(body: unknown, userId: string | null = "user-1"): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (userId) headers["x-user-id"] = userId;
  return new Request("http://localhost/api/runs/run-1/reveal", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  }) as unknown as NextRequest;
}

const PARAMS = { params: Promise.resolve({ runId: "run-1" }) };

describe("GET /api/runs/[runId]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a user", async () => {
    const res = await GET(makeGet("0", null), PARAMS);
    expect(res.status).toBe(401);
    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing, negative or non-integer index", async () => {
    expect((await GET(makeGet(null), PARAMS)).status).toBe(400);
    expect((await GET(makeGet("-1"), PARAMS)).status).toBe(400);
    expect((await GET(makeGet("abc"), PARAMS)).status).toBe(400);
    expect((await GET(makeGet("1.5"), PARAMS)).status).toBe(400);
    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("maps not_found to 404 and forbidden to 403", async () => {
    getAnswerRevealMock.mockResolvedValue({ error: "not_found" });
    expect((await GET(makeGet(), PARAMS)).status).toBe(404);

    getAnswerRevealMock.mockResolvedValue({ error: "forbidden" });
    expect((await GET(makeGet(), PARAMS)).status).toBe(403);
  });

  it("maps wrong_phase (EXAM) and wrong_index to 409", async () => {
    getAnswerRevealMock.mockResolvedValue({
      error: "wrong_phase",
      message: "Model answers appear after the last question of an exam simulation.",
    });
    expect((await GET(makeGet(), PARAMS)).status).toBe(409);

    getAnswerRevealMock.mockResolvedValue({ error: "wrong_index", expected: 2 });
    const res = await GET(makeGet("5"), PARAMS);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This question was answered in another tab. Reload to continue.",
      code: "wrong_index",
      expected: 2,
    });
  });

  it("answers 409 answer_required for an unanswered free-recall question", async () => {
    getAnswerRevealMock.mockResolvedValue({ error: "answer_required" });

    const res = await GET(makeGet(), PARAMS);

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("answer_required");
    expect(body).not.toHaveProperty("model_answer");
  });

  it("never passes an answer to the service, so GET can't commit one", async () => {
    getAnswerRevealMock.mockResolvedValue({
      data: { model_answer: "Water moves toward solute.", key_points: ["gradient"], committed_answer: "x" },
    });

    const res = await GET(makeGet(), PARAMS);

    expect(res.status).toBe(200);
    expect(getAnswerRevealMock).toHaveBeenCalledWith("user-1", "run-1", 0);
  });

  it("returns 500 with a readable message when the service throws", async () => {
    getAnswerRevealMock.mockRejectedValue(new Error("boom"));

    const res = await GET(makeGet(), PARAMS);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "The model answer didn't load. Retry." });
  });
});

describe("POST /api/runs/[runId]/reveal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 without a user", async () => {
    const res = await POST(makePost({ index: 0, user_answer: "osmosis" }, null), PARAMS);
    expect(res.status).toBe(401);
    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, a blank answer and a bad index", async () => {
    expect((await POST(makePost("{not json"), PARAMS)).status).toBe(400);

    const blank = await POST(makePost({ index: 0, user_answer: "   " }), PARAMS);
    expect(blank.status).toBe(400);
    expect((await blank.json()).error).toBe("Write an answer before you check it.");

    const badIndex = await POST(makePost({ index: -1, user_answer: "osmosis" }), PARAMS);
    expect(badIndex.status).toBe(400);
    expect((await badIndex.json()).error).toBe("This question isn't in the session. Reload to continue.");

    expect(getAnswerRevealMock).not.toHaveBeenCalled();
  });

  it("passes the trimmed answer to the service and returns the reveal", async () => {
    getAnswerRevealMock.mockResolvedValue({
      data: {
        model_answer: "Water moves toward the higher solute concentration.",
        key_points: ["gradient", "membrane"],
        committed_answer: "osmosis moves water",
      },
    });

    const res = await POST(makePost({ index: 3, user_answer: "  osmosis moves water  " }), PARAMS);

    expect(res.status).toBe(200);
    expect(getAnswerRevealMock).toHaveBeenCalledWith("user-1", "run-1", 3, {
      userAnswer: "osmosis moves water",
    });
    expect(await res.json()).toEqual({
      model_answer: "Water moves toward the higher solute concentration.",
      key_points: ["gradient", "membrane"],
      committed_answer: "osmosis moves water",
    });
  });

  it("maps service errors the same way as GET", async () => {
    getAnswerRevealMock.mockResolvedValue({ error: "forbidden" });
    expect((await POST(makePost({ index: 0, user_answer: "a" }), PARAMS)).status).toBe(403);

    getAnswerRevealMock.mockResolvedValue({ error: "wrong_index", expected: 1 });
    expect((await POST(makePost({ index: 0, user_answer: "a" }), PARAMS)).status).toBe(409);
  });
});
