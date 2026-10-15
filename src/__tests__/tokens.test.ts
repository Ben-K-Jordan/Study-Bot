/**
 * Unit tests for src/lib/tokens.ts: link tokens are used at most once and
 * report why a link didn't work (expired, used, invalid).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { verificationToken } = vi.hoisted(() => ({
  verificationToken: { updateMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: { verificationToken } }));

import { classifyToken, consumeToken, inspectToken, redeemToken } from "@/lib/tokens";

const NOW = new Date("2026-10-15T12:00:00Z");
const HOUR = 60 * 60 * 1000;

function record(overrides: Partial<{ type: string; expiresAt: Date; usedAt: Date | null }> = {}) {
  return {
    userId: "user-1",
    type: "PASSWORD_RESET",
    expiresAt: new Date(NOW.getTime() + HOUR),
    usedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyToken", () => {
  it("sorts a record into valid, expired, used or invalid", () => {
    expect(classifyToken(record(), "PASSWORD_RESET", NOW)).toEqual({ status: "valid", userId: "user-1" });
    expect(classifyToken(record({ expiresAt: new Date(NOW.getTime() - 1) }), "PASSWORD_RESET", NOW)).toEqual({
      status: "expired",
      userId: "user-1",
    });
    expect(classifyToken(record({ usedAt: NOW }), "PASSWORD_RESET", NOW)).toEqual({
      status: "used",
      userId: "user-1",
    });
    expect(classifyToken(record(), "EMAIL_VERIFY", NOW)).toEqual({ status: "invalid" });
    expect(classifyToken(null, "PASSWORD_RESET", NOW)).toEqual({ status: "invalid" });
  });

  it("reports used before expired", () => {
    const stale = record({ usedAt: NOW, expiresAt: new Date(NOW.getTime() - HOUR) });
    expect(classifyToken(stale, "PASSWORD_RESET", NOW).status).toBe("used");
  });
});

describe("redeemToken", () => {
  it("claims an unused, unexpired token with one conditional update", async () => {
    verificationToken.updateMany.mockResolvedValue({ count: 1 });
    verificationToken.findUnique.mockResolvedValue(record({ usedAt: NOW }));

    expect(await redeemToken("tok", "PASSWORD_RESET")).toEqual({ status: "valid", userId: "user-1" });
    const where = verificationToken.updateMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ token: "tok", type: "PASSWORD_RESET", usedAt: null });
    expect(where.expiresAt.gt).toBeInstanceOf(Date);
  });

  it("explains why a token couldn't be claimed", async () => {
    verificationToken.updateMany.mockResolvedValue({ count: 0 });

    verificationToken.findUnique.mockResolvedValueOnce(record({ usedAt: NOW }));
    expect((await redeemToken("tok", "PASSWORD_RESET")).status).toBe("used");

    verificationToken.findUnique.mockResolvedValueOnce(record({ expiresAt: new Date(Date.now() - HOUR) }));
    expect((await redeemToken("tok", "PASSWORD_RESET")).status).toBe("expired");

    verificationToken.findUnique.mockResolvedValueOnce(null);
    expect((await redeemToken("tok", "PASSWORD_RESET")).status).toBe("invalid");
  });

  it("never lets an unclaimed token through as valid", async () => {
    verificationToken.updateMany.mockResolvedValue({ count: 0 });
    verificationToken.findUnique.mockResolvedValue(record({ expiresAt: new Date(Date.now() + HOUR) }));
    expect((await redeemToken("tok", "PASSWORD_RESET")).status).toBe("used");
  });

  it("rejects an empty token without a query", async () => {
    expect(await redeemToken("", "EMAIL_VERIFY")).toEqual({ status: "invalid" });
    expect(verificationToken.updateMany).not.toHaveBeenCalled();
  });

  it("keeps consumeToken's userId-or-null contract", async () => {
    verificationToken.updateMany.mockResolvedValue({ count: 1 });
    verificationToken.findUnique.mockResolvedValue(record({ usedAt: NOW }));
    expect(await consumeToken("tok", "PASSWORD_RESET")).toBe("user-1");

    verificationToken.updateMany.mockResolvedValue({ count: 0 });
    expect(await consumeToken("tok", "PASSWORD_RESET")).toBeNull();
  });
});

describe("inspectToken", () => {
  it("reads without writing", async () => {
    verificationToken.findUnique.mockResolvedValue(record({ expiresAt: new Date(Date.now() - HOUR) }));
    expect((await inspectToken("tok", "PASSWORD_RESET")).status).toBe("expired");
    expect(verificationToken.updateMany).not.toHaveBeenCalled();
  });
});
