/**
 * DELETE /api/account/delete: the confirmation phrase contract and the
 * best-effort Google revoke before the data goes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth", () => ({
  getUserId: vi.fn(async (request: Request) => request.headers.get("x-user-id")),
}));

vi.mock("@/lib/crypto/token-vault", () => ({
  decryptToken: vi.fn((value: string) => `plain-${value}`),
}));

const deleteMany = () => vi.fn(async () => ({ count: 0 }));
const tx = {
  cardReview: { deleteMany: deleteMany() },
  xpEvent: { deleteMany: deleteMany() },
  achievement: { deleteMany: deleteMany() },
  objectiveMastery: { deleteMany: deleteMany() },
  aiCallLog: { deleteMany: deleteMany() },
  oAuthState: { deleteMany: deleteMany() },
  studyGuide: { deleteMany: deleteMany() },
  planItemExternalEvent: { deleteMany: deleteMany() },
  planCalendarPublication: { deleteMany: deleteMany() },
  planReflowAudit: { deleteMany: deleteMany() },
  objectiveAnchor: { deleteMany: deleteMany() },
  sessionErrorLog: { deleteMany: deleteMany() },
  chatMessage: { deleteMany: deleteMany() },
  verificationToken: { deleteMany: deleteMany() },
  sessionAttempt: { deleteMany: deleteMany() },
  studyPlanItem: { deleteMany: deleteMany() },
  evidencePaper: { deleteMany: deleteMany() },
  flashcardDeck: { deleteMany: deleteMany() },
  sessionRun: { deleteMany: deleteMany() },
  googleIntegration: { deleteMany: deleteMany() },
  userGameState: { deleteMany: deleteMany() },
  session: { deleteMany: deleteMany() },
  contentDocument: { deleteMany: deleteMany() },
  studyPlan: { deleteMany: deleteMany() },
  user: { delete: vi.fn(async () => ({})) },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    googleIntegration: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

import { DELETE } from "@/app/api/account/delete/route";
import { DELETE_ACCOUNT_PHRASE } from "@/app/api/account/delete/phrase";
import { prisma } from "@/lib/db";

const findIntegration = vi.mocked(prisma.googleIntegration.findUnique);

function request(body: unknown, userId: string | null = "u1"): NextRequest {
  return new Request("http://localhost:3000/api/account/delete", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...(userId ? { "x-user-id": userId } : {}) },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;
}

describe("DELETE /api/account/delete", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the confirmation phrase the client sends", () => {
    expect(DELETE_ACCOUNT_PHRASE).toBe("DELETE MY ACCOUNT");
  });

  it("refuses without the phrase, with a sentence instead of a schema dump", async () => {
    const res = await DELETE(request({ confirm: "delete" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Account not deleted. Confirm in the dialog and retry.");
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("answers 401 when signed out", async () => {
    const res = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE }, null));
    expect(res.status).toBe(401);
  });

  it("revokes Google access, then deletes everything", async () => {
    findIntegration.mockResolvedValue({ accessTokenEncrypted: "a", refreshTokenEncrypted: "r" } as never);
    const res = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=plain-r");
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("still deletes when the revoke fails or there is no integration", async () => {
    findIntegration.mockResolvedValue(null);
    expect((await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE }))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    findIntegration.mockResolvedValue({ accessTokenEncrypted: "a", refreshTokenEncrypted: null } as never);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE }))).status).toBe(200);
  });
});
