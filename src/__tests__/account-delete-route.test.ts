/**
 * DELETE /api/account/delete: the confirmation phrase and password contract,
 * the best-effort Google revoke before the data goes, and the uploaded files
 * removed after it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

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
  jobQueue: { deleteMany: deleteMany() },
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
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  },
}));

vi.mock("@/services/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/account")>()),
  deleteUserFiles: vi.fn(async () => {}),
}));

import { DELETE } from "@/app/api/account/delete/route";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account";
import { prisma } from "@/lib/db";
import { accountDeleteLimiter, deleteUserFiles } from "@/services/account";

const findIntegration = vi.mocked(prisma.googleIntegration.findUnique);
const findUser = vi.mocked(prisma.user.findUnique);
const removeFiles = vi.mocked(deleteUserFiles);

const PASSWORD = "correct horse";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const confirmed = { confirm: DELETE_ACCOUNT_PHRASE, password: PASSWORD };

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
    accountDeleteLimiter.reset();
    vi.stubGlobal("fetch", fetchMock);
    findUser.mockResolvedValue({ passwordHash: PASSWORD_HASH } as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the confirmation phrase the client sends", () => {
    expect(DELETE_ACCOUNT_PHRASE).toBe("DELETE MY ACCOUNT");
  });

  it("refuses without the phrase, with a sentence instead of a schema dump", async () => {
    const res = await DELETE(request({ confirm: "delete", password: PASSWORD }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Account not deleted. Confirm in the dialog and retry.");
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("refuses the phrase alone, so a session without the password can't delete", async () => {
    const res = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE }));
    expect(res.status).toBe(400);
    expect(findUser).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("answers 403 with a password issue when the password is wrong, and keeps everything", async () => {
    findIntegration.mockResolvedValue({ accessTokenEncrypted: "a", refreshTokenEncrypted: "r" } as never);
    const res = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE, password: "wrong" }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("WRONG_PASSWORD");
    expect(body.error).toBe("That password doesn't match your account. Check it and retry.");
    expect(body.issues).toEqual([{ path: ["password"], message: body.error }]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(tx.user.delete).not.toHaveBeenCalled();
    expect(removeFiles).not.toHaveBeenCalled();
  });

  it("limits password attempts per student", async () => {
    let res: Response | undefined;
    for (let i = 0; i < 60; i++) {
      res = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE, password: "wrong" }));
      if (res.status === 429) break;
    }
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toBeTruthy();
    // Another student isn't affected.
    const other = await DELETE(request({ confirm: DELETE_ACCOUNT_PHRASE, password: "wrong" }, "u2"));
    expect(other.status).toBe(403);
  });

  it("answers 401 when signed out", async () => {
    const res = await DELETE(request(confirmed, null));
    expect(res.status).toBe(401);
  });

  it("answers 401 when the session's account no longer exists", async () => {
    findUser.mockResolvedValue(null);
    const res = await DELETE(request(confirmed));
    expect(res.status).toBe(401);
    expect(tx.user.delete).not.toHaveBeenCalled();
  });

  it("revokes Google access, deletes everything, then removes the uploaded files", async () => {
    findIntegration.mockResolvedValue({ accessTokenEncrypted: "a", refreshTokenEncrypted: "r" } as never);
    const res = await DELETE(request(confirmed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init.body)).toBe("token=plain-r");
    expect(tx.user.delete).toHaveBeenCalledWith({ where: { id: "u1" } });
    expect(tx.jobQueue.deleteMany).toHaveBeenCalledWith({
      where: { payload: { path: ["userId"], equals: "u1" }, status: { not: "RUNNING" } },
    });
    expect(removeFiles).toHaveBeenCalledWith("u1");
    expect(removeFiles.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.user.delete.mock.invocationCallOrder[0],
    );
  });

  it("keeps the files when the database deletion fails", async () => {
    findIntegration.mockResolvedValue(null);
    tx.user.delete.mockRejectedValueOnce(new Error("db down"));
    const res = await DELETE(request(confirmed));
    expect(res.status).toBe(500);
    expect(removeFiles).not.toHaveBeenCalled();
  });

  it("still answers deleted when removing the files fails", async () => {
    findIntegration.mockResolvedValue(null);
    removeFiles.mockRejectedValueOnce(new Error("EBUSY"));
    const res = await DELETE(request(confirmed));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
  });

  it("still deletes when the revoke fails or there is no integration", async () => {
    findIntegration.mockResolvedValue(null);
    expect((await DELETE(request(confirmed))).status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();

    findIntegration.mockResolvedValue({ accessTokenEncrypted: "a", refreshTokenEncrypted: null } as never);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect((await DELETE(request(confirmed))).status).toBe(200);
  });
});
