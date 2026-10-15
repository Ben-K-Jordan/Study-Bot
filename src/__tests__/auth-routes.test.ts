/**
 * Unit tests for the auth API routes: field issues the forms map onto
 * fields, rate-limit wording, reset-link codes, anti-enumeration answers,
 * and verification links that always land on a page instead of JSON.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { prisma } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    userGameState: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/tokens", () => ({
  redeemToken: vi.fn(),
  createPasswordResetToken: vi.fn(async () => "reset-token"),
  createEmailVerificationToken: vi.fn(async () => "verify-token"),
}));
vi.mock("@/lib/email/provider", () => ({ emailProvider: { send: vi.fn(async () => undefined) } }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));

import { redeemToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import { authEmailLimiter, authTokenLimiter, signupLimiter } from "@/lib/rate-limit";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { GET as verifyEmail } from "@/app/api/auth/verify-email/route";

const redeemTokenMock = vi.mocked(redeemToken);

let ipCounter = 0;
function post(path: string, body: unknown, ip = `10.0.0.${++ipCounter}`) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-real-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function get(path: string, ip = `10.0.1.${++ipCounter}`) {
  return new NextRequest(`http://localhost:3000${path}`, { headers: { "x-real-ip": ip } });
}

beforeEach(() => {
  vi.clearAllMocks();
  authEmailLimiter.reset();
  authTokenLimiter.reset();
  signupLimiter.reset();
});

describe("POST /api/auth/signup", () => {
  it("returns one issue per field in the forms' words", async () => {
    const res = await signup(post("/api/auth/signup", { name: " ", email: "a@b", password: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("INVALID_FIELDS");
    expect(body.issues).toEqual([
      { field: "name", message: "Enter your name." },
      { field: "email", message: "Enter an email address like name@example.com." },
      { field: "password", message: "Use at least 8 characters." },
    ]);
  });

  it("answers 400 for a body that isn't JSON", async () => {
    const res = await signup(post("/api/auth/signup", "not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("INVALID_BODY");
  });

  it("gives the same 201 for a new and a taken email", async () => {
    prisma.$transaction.mockResolvedValueOnce({ id: "u1", email: "new@example.com", name: "New" });
    const created = await signup(post("/api/auth/signup", { name: "New", email: "New@Example.com", password: "12345678" }));
    expect(created.status).toBe(201);
    expect(emailProvider.send).toHaveBeenCalledOnce();

    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const taken = await signup(post("/api/auth/signup", { name: "Old", email: "old@example.com", password: "12345678" }));
    expect(taken.status).toBe(201);
    expect(await taken.json()).toEqual(await created.json());
  });

  it("hides server failures behind a plain message", async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error("connection refused"));
    const res = await signup(post("/api/auth/signup", { name: "A", email: "a@example.com", password: "12345678" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Account not created. Check your connection and retry.");
  });
});

describe("POST /api/auth/forgot-password", () => {
  it("rejects a malformed email with a field issue instead of claiming success", async () => {
    const res = await forgotPassword(post("/api/auth/forgot-password", { email: "a@b" }));
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([
      { field: "email", message: "Enter an email address like name@example.com." },
    ]);
  });

  it("answers the same whether or not the account exists", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const missing = await forgotPassword(post("/api/auth/forgot-password", { email: "nobody@example.com" }));
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "me@example.com", name: "Me" });
    const found = await forgotPassword(post("/api/auth/forgot-password", { email: "me@example.com" }));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual(await found.json());
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });

  it("words its rate limit with the wait", async () => {
    const ip = "10.9.9.9";
    let res: Response | undefined;
    for (let i = 0; i < 200; i++) {
      res = await forgotPassword(post("/api/auth/forgot-password", { email: "x" }, ip));
      if (res.status === 429) break;
    }
    expect(res?.status).toBe(429);
    expect(res?.headers.get("Retry-After")).toMatch(/^\d+$/);
    expect((await res!.json()).error).toMatch(/^Too many reset requests\. Retry in \d+ minutes?\.$/);
  });
});

describe("POST /api/auth/resend-verification", () => {
  it("validates the email and never says whether an account exists", async () => {
    expect((await resendVerification(post("/api/auth/resend-verification", {}))).status).toBe(400);

    prisma.user.findUnique.mockResolvedValueOnce(null);
    const missing = await resendVerification(post("/api/auth/resend-verification", { email: "x@example.com" }));
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "y@example.com", name: "Y", emailVerified: null });
    const pending = await resendVerification(post("/api/auth/resend-verification", { email: "y@example.com" }));
    expect(await missing.json()).toEqual(await pending.json());
    expect(emailProvider.send).toHaveBeenCalledOnce();
  });
});

describe("POST /api/auth/reset-password", () => {
  it("maps a short password to the password field", async () => {
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([{ field: "password", message: "Use at least 8 characters." }]);
    expect(redeemTokenMock).not.toHaveBeenCalled();
  });

  it("returns a code for each kind of bad link", async () => {
    for (const [status, code] of [
      ["expired", "TOKEN_EXPIRED"],
      ["used", "TOKEN_USED"],
      ["invalid", "TOKEN_INVALID"],
    ] as const) {
      redeemTokenMock.mockResolvedValueOnce(status === "invalid" ? { status } : { status, userId: "u1" });
      const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("treats a missing token as an invalid link", async () => {
    redeemTokenMock.mockResolvedValueOnce({ status: "invalid" });
    const res = await resetPassword(post("/api/auth/reset-password", { password: "12345678" }));
    expect((await res.json()).code).toBe("TOKEN_INVALID");
    expect(redeemTokenMock).toHaveBeenCalledWith("", "PASSWORD_RESET");
  });

  it("updates the password with a valid link", async () => {
    redeemTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { passwordHash: "hashed" } });
  });
});

describe("GET /api/auth/verify-email", () => {
  function location(res: Response) {
    return res.headers.get("location");
  }

  it("lands on sign-in with a banner when the link works", async () => {
    redeemTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    const res = await verifyEmail(get("/api/auth/verify-email?token=t"));
    expect(res.status).toBe(303);
    expect(location(res)).toBe("http://localhost:3000/auth/signin?verified=true");
  });

  it("lands on the verify page, never JSON, when the link is missing, bad or expired", async () => {
    const missing = await verifyEmail(get("/api/auth/verify-email"));
    expect(location(missing)).toBe("http://localhost:3000/auth/verify-email?status=invalid");

    redeemTokenMock.mockResolvedValueOnce({ status: "invalid" });
    expect(location(await verifyEmail(get("/api/auth/verify-email?token=t")))).toBe(
      "http://localhost:3000/auth/verify-email?status=invalid",
    );

    redeemTokenMock.mockResolvedValueOnce({ status: "expired", userId: "u1" });
    expect(location(await verifyEmail(get("/api/auth/verify-email?token=t")))).toBe(
      "http://localhost:3000/auth/verify-email?status=expired",
    );
  });

  it("sends an already verified account to sign-in when the link is reused", async () => {
    redeemTokenMock.mockResolvedValueOnce({ status: "used", userId: "u1" });
    prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: new Date() });
    expect(location(await verifyEmail(get("/api/auth/verify-email?token=t")))).toBe(
      "http://localhost:3000/auth/signin?verified=true",
    );

    redeemTokenMock.mockResolvedValueOnce({ status: "used", userId: "u1" });
    prisma.user.findUnique.mockResolvedValueOnce({ emailVerified: null });
    expect(location(await verifyEmail(get("/api/auth/verify-email?token=t")))).toBe(
      "http://localhost:3000/auth/verify-email?status=invalid",
    );
  });

  it("lands on a page when the server fails", async () => {
    redeemTokenMock.mockRejectedValueOnce(new Error("db down"));
    expect(location(await verifyEmail(get("/api/auth/verify-email?token=t")))).toBe(
      "http://localhost:3000/auth/verify-email?status=failed",
    );
  });
});
