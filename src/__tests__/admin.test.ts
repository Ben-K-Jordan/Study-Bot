/**
 * Unit tests for requireAdmin, the gate on /api/admin routes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

import { requireAdmin } from "@/lib/admin";
import { UNAUTHORIZED_BODY } from "@/lib/http";

function req(userId?: string) {
  return new Request("http://localhost/api/admin/jobs", {
    headers: userId ? { "x-user-id": userId } : {},
  });
}

describe("requireAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_USER_IDS", "admin-1, admin-2");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("answers 401 without a user, with the proxy's body", async () => {
    const result = await requireAdmin(req());
    expect("response" in result && result.response.status).toBe(401);
    if ("response" in result) expect(await result.response.json()).toEqual(UNAUTHORIZED_BODY);
  });

  it("answers 403 for a user not in ADMIN_USER_IDS", async () => {
    const result = await requireAdmin(req("someone"));
    expect("response" in result && result.response.status).toBe(403);
  });

  it("returns the admin's ID, trimming list entries", async () => {
    expect(await requireAdmin(req("admin-2"))).toEqual({ userId: "admin-2" });
  });

  it("treats an empty list as no admins", async () => {
    vi.stubEnv("ADMIN_USER_IDS", "");
    const result = await requireAdmin(req("admin-1"));
    expect("response" in result && result.response.status).toBe(403);
  });
});
