import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/services/session", () => ({
  getSessionResults: vi.fn(),
}));

import { GET } from "@/app/api/sessions/[sessionId]/runs/[runId]/results/route";
import { getSessionResults } from "@/services/session";

const getSessionResultsMock = vi.mocked(getSessionResults);

function call(sessionId: string, runId: string, userId: string | null = "user-1") {
  const headers: Record<string, string> = {};
  if (userId) headers["x-user-id"] = userId;
  const request = new Request(`http://localhost/api/sessions/${sessionId}/runs/${runId}/results`, {
    headers,
  }) as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ sessionId, runId }) });
}

beforeEach(() => {
  getSessionResultsMock.mockReset();
});

describe("GET /api/sessions/:sessionId/runs/:runId/results", () => {
  it("needs a signed-in student", async () => {
    const res = await call("sess-1", "run-1", null);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("UNAUTHORIZED");
    expect(body.error).toBe("Your sign-in expired. Sign in again.");
  });

  it("answers malformed IDs with not found, without a lookup", async () => {
    const res = await call("sess-1", "../etc");
    expect(res.status).toBe(404);
    expect(getSessionResultsMock).not.toHaveBeenCalled();
  });

  it("maps service errors to statuses and readable messages", async () => {
    getSessionResultsMock.mockResolvedValueOnce({ error: "forbidden" });
    expect((await call("sess-1", "run-1")).status).toBe(403);

    getSessionResultsMock.mockResolvedValueOnce({ error: "not_completed" });
    const open = await call("sess-1", "run-1");
    expect(open.status).toBe(409);
    expect(await open.json()).toEqual({
      error: "Finish the session to see its results.",
      code: "run_not_completed",
    });

    getSessionResultsMock.mockResolvedValueOnce({ error: "not_found" });
    expect((await call("sess-1", "run-1")).status).toBe(404);
  });

  it("returns the results for the owner", async () => {
    const data = { run_id: "run-1", session_id: "sess-1" } as never;
    getSessionResultsMock.mockResolvedValueOnce({ data });
    const res = await call("sess-1", "run-1");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
    expect(getSessionResultsMock).toHaveBeenCalledWith("user-1", "sess-1", "run-1");
  });

  it("reports an unexpected failure without the raw error", async () => {
    getSessionResultsMock.mockRejectedValueOnce(new Error("connection reset"));
    const res = await call("sess-1", "run-1");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Results didn't load. Retry in a moment.");
    expect(JSON.stringify(body)).not.toMatch(/connection reset/);
  });
});
