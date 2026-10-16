/**
 * Unit tests for the auth API routes: field issues the forms map onto
 * fields, rate-limit wording, reset-link codes, anti-enumeration answers
 * (emails go out after the response, so both answers take the same time),
 * and verification links that always land on a page instead of JSON.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { prisma, afterTasks } = vi.hoisted(() => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    userGameState: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  afterTasks: [] as Array<() => unknown>,
}));

vi.mock("@/lib/db", () => ({ prisma }));
// after() needs a request scope; collect the tasks and run them by hand.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (task: () => unknown) => {
    afterTasks.push(task);
  },
}));
vi.mock("@/lib/tokens", () => ({
  inspectToken: vi.fn(),
  redeemToken: vi.fn(),
  createPasswordResetToken: vi.fn(async () => "reset-token"),
  createEmailVerificationToken: vi.fn(async () => "verify-token"),
}));
vi.mock("@/lib/email/provider", () => ({ emailProvider: { send: vi.fn(async () => undefined) } }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hashed") } }));

import { inspectToken, redeemToken } from "@/lib/tokens";
import { emailProvider } from "@/lib/email/provider";
import bcrypt from "bcryptjs";
import { authEmailLimiter, authTokenLimiter, signupLimiter } from "@/lib/rate-limit";
import { authEmailAddressLimiter, signInFailureLimiter } from "@/app/api/auth/_lib/limits";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as forgotPassword } from "@/app/api/auth/forgot-password/route";
import { POST as resendVerification } from "@/app/api/auth/resend-verification/route";
import { POST as resetPassword } from "@/app/api/auth/reset-password/route";
import { GET as verifyEmail } from "@/app/api/auth/verify-email/route";

const redeemTokenMock = vi.mocked(redeemToken);
const inspectTokenMock = vi.mocked(inspectToken);

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

/** Run what the routes deferred until after their response. */
async function runAfterTasks() {
  const tasks = afterTasks.splice(0);
  for (const task of tasks) await task();
}

beforeEach(() => {
  vi.clearAllMocks();
  afterTasks.length = 0;
  authEmailLimiter.reset();
  authEmailAddressLimiter.reset();
  authTokenLimiter.reset();
  signupLimiter.reset();
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("gives the same 201 for a new and a taken email, and sends the link after answering", async () => {
    vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "true");
    prisma.$transaction.mockResolvedValueOnce({ id: "u1", email: "new@example.com", name: "New" });
    const created = await signup(post("/api/auth/signup", { name: "New", email: "New@Example.com", password: "12345678" }));
    expect(created.status).toBe(201);
    expect(emailProvider.send).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(emailProvider.send).toHaveBeenCalledOnce();

    prisma.$transaction.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    const taken = await signup(post("/api/auth/signup", { name: "Old", email: "old@example.com", password: "12345678" }));
    expect(taken.status).toBe(201);
    expect(await taken.json()).toEqual(await created.json());
    expect(afterTasks).toHaveLength(0);
    // Both paths hash the password, so a taken email isn't the faster answer.
    expect(bcrypt.hash).toHaveBeenCalledTimes(2);
    expect(bcrypt.hash).toHaveBeenCalledWith("12345678", 12);
  });

  it("sends no verification email when sign-in doesn't require one", async () => {
    prisma.$transaction.mockResolvedValueOnce({ id: "u1", email: "new@example.com", name: "New" });
    const res = await signup(post("/api/auth/signup", { name: "New", email: "new@example.com", password: "12345678" }));
    expect(res.status).toBe(201);
    await runAfterTasks();
    expect(emailProvider.send).not.toHaveBeenCalled();
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

  it("answers the same whether or not the account exists, and sends after answering", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    const missing = await forgotPassword(post("/api/auth/forgot-password", { email: "nobody@example.com" }));
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u1", email: "me@example.com", name: "Me" });
    const found = await forgotPassword(post("/api/auth/forgot-password", { email: "Me@Example.com" }));
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual(await found.json());
    expect(prisma.user.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { email: "me@example.com" } }),
    );
    expect(emailProvider.send).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(emailProvider.send).toHaveBeenCalledOnce();
    expect(vi.mocked(emailProvider.send).mock.calls[0][0]).toBe("me@example.com");
  });

  it("limits requests per address across networks", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    let res: Response | undefined;
    for (let i = 0; i < 200; i++) {
      res = await forgotPassword(post("/api/auth/forgot-password", { email: "target@example.com" }));
      if (res.status === 429) break;
    }
    expect(res?.status).toBe(429);
    expect((await res!.json()).error).toMatch(/^Too many reset requests\. Retry in \d+ minutes?\.$/);
    // Another address is unaffected.
    expect((await forgotPassword(post("/api/auth/forgot-password", { email: "other@example.com" }))).status).toBe(200);
  });

  it("says no link went out, for every address, when a production server can't send email", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("ALLOW_TEST_AUTH", "");
    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "me@example.com", name: "Me" });
    const known = await forgotPassword(post("/api/auth/forgot-password", { email: "me@example.com" }));
    const unknown = await forgotPassword(post("/api/auth/forgot-password", { email: "nobody@example.com" }));
    expect(known.status).toBe(503);
    const body = await known.json();
    expect(body).toEqual({
      code: "EMAIL_NOT_CONFIGURED",
      error: "Reset link not sent. Email isn't set up on this Study Bot server. Ask whoever runs the server to turn on email.",
    });
    expect(await unknown.json()).toEqual(body);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(afterTasks).toHaveLength(0);

    // SMTP delivers, so the usual answer comes back.
    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    expect((await forgotPassword(post("/api/auth/forgot-password", { email: "me@example.com" }))).status).toBe(200);
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
    prisma.user.findUnique.mockResolvedValueOnce({ id: "u2", email: "z@example.com", name: "Z", emailVerified: new Date() });
    const verified = await resendVerification(post("/api/auth/resend-verification", { email: "z@example.com" }));
    const answer = await pending.json();
    expect(await missing.json()).toEqual(answer);
    expect(await verified.json()).toEqual(answer);
    expect(emailProvider.send).not.toHaveBeenCalled();
    await runAfterTasks();
    expect(emailProvider.send).toHaveBeenCalledOnce();
    expect(vi.mocked(emailProvider.send).mock.calls[0][0]).toBe("y@example.com");
  });

  it("says no link went out when a production server can't send email", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("ALLOW_TEST_AUTH", "");
    const res = await resendVerification(post("/api/auth/resend-verification", { email: "y@example.com" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      code: "EMAIL_NOT_CONFIGURED",
      error: "New link not sent. Email isn't set up on this Study Bot server. Ask whoever runs the server to turn on email.",
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();

    // A CI e2e server reads links from the database, so it still makes them.
    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    vi.stubEnv("CI", "true");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    prisma.user.findUnique.mockResolvedValueOnce(null);
    expect((await resendVerification(post("/api/auth/resend-verification", { email: "y@example.com" }))).status).toBe(200);
  });
});

describe("POST /api/auth/reset-password", () => {
  // The transaction's client: the claim and the password write both go through it.
  const tx = { user: { update: vi.fn() } };

  beforeEach(() => {
    signInFailureLimiter.reset();
    prisma.$transaction.mockImplementation(async (work: (client: typeof tx) => unknown) => work(tx));
    tx.user.update.mockReset();
    tx.user.update.mockResolvedValue({ email: "me@example.com" });
  });

  afterEach(() => {
    prisma.$transaction.mockReset();
  });

  it("maps a short password to the password field", async () => {
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "short" }));
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([{ field: "password", message: "Use at least 8 characters." }]);
    expect(redeemTokenMock).not.toHaveBeenCalled();
  });

  it("refuses a password longer than bcrypt hashes, rather than cutting it short", async () => {
    // 37 accented letters: 37 characters, 74 bytes.
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "\u00e9".repeat(37) }));
    expect(res.status).toBe(400);
    expect((await res.json()).issues).toEqual([{ field: "password", message: "Use a shorter password." }]);
    expect(inspectTokenMock).not.toHaveBeenCalled();
  });

  it("returns a code for each kind of bad link, before any bcrypt work", async () => {
    for (const [status, code] of [
      ["expired", "TOKEN_EXPIRED"],
      ["used", "TOKEN_USED"],
      ["invalid", "TOKEN_INVALID"],
    ] as const) {
      inspectTokenMock.mockResolvedValueOnce(status === "invalid" ? { status } : { status, userId: "u1" });
      const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe(code);
    }
    expect(bcrypt.hash).not.toHaveBeenCalled();
    expect(redeemTokenMock).not.toHaveBeenCalled();
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("treats a missing token as an invalid link", async () => {
    inspectTokenMock.mockResolvedValueOnce({ status: "invalid" });
    const res = await resetPassword(post("/api/auth/reset-password", { password: "12345678" }));
    expect((await res.json()).code).toBe("TOKEN_INVALID");
    expect(inspectTokenMock).toHaveBeenCalledWith("", "PASSWORD_RESET");
  });

  it("claims the link and saves the password in one transaction", async () => {
    inspectTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    redeemTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
    expect(res.status).toBe(200);
    expect(redeemTokenMock).toHaveBeenCalledWith("t", "PASSWORD_RESET", tx);
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { passwordHash: "hashed" },
      select: { email: true },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
    // The hash is ready before the transaction starts.
    expect(vi.mocked(bcrypt.hash).mock.invocationCallOrder[0]).toBeLessThan(
      prisma.$transaction.mock.invocationCallOrder[0],
    );
  });

  it("answers 500 when the password isn't saved, with the claim inside the transaction that failed", async () => {
    inspectTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    redeemTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    tx.user.update.mockRejectedValueOnce(new Error("connection reset"));
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("Password not changed. Check your connection and retry.");
    // The claim ran on the transaction's client, so the database rolls it
    // back with the failed write and the same link works for a retry.
    expect(redeemTokenMock).toHaveBeenCalledWith("t", "PASSWORD_RESET", tx);
  });

  it("says the link was used when another request claimed it first", async () => {
    inspectTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    redeemTokenMock.mockResolvedValueOnce({ status: "used", userId: "u1" });
    const res = await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("TOKEN_USED");
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("lifts the sign-in lock on the account, so the new password works at once", async () => {
    for (let i = 0; i < 400; i++) signInFailureLimiter.start("me@example.com");
    expect(signInFailureLimiter.start("me@example.com").allowed).toBe(false);

    inspectTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    redeemTokenMock.mockResolvedValueOnce({ status: "valid", userId: "u1" });
    tx.user.update.mockResolvedValueOnce({ email: "Me@Example.com" });
    expect((await resetPassword(post("/api/auth/reset-password", { token: "t", password: "12345678" }))).status).toBe(200);
    expect(signInFailureLimiter.start("me@example.com").allowed).toBe(true);
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
