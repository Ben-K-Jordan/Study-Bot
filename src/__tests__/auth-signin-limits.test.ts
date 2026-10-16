/**
 * Unit tests for the sign-in limits in src/app/api/auth/[...nextauth]/route.ts
 * and src/app/api/auth/_lib/limits.ts: wrong passwords count per account
 * from any network, right passwords and sign-out never use up attempts,
 * and the limiter reads the same email next-auth checks.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("next-auth", () => ({ default: () => handler }));
vi.mock("@/lib/auth-options", () => ({ authOptions: {} }));

import { POST } from "@/app/api/auth/[...nextauth]/route";
import {
  createFailureLimiter,
  readSignInEmail,
  signInErrorCode,
  signInFailureLimiter,
} from "@/app/api/auth/_lib/limits";
import { authLimiter } from "@/lib/rate-limit";

const BASE = "http://localhost:3000/api/auth";
const FAILED = `${BASE}/error?error=CredentialsSignin&provider=credentials`;

function nextAuthAnswer(url: string, status: number) {
  return new Response(JSON.stringify({ url }), { status, headers: { "content-type": "application/json" } });
}

let ipCounter = 0;
function signInRequest(email: string, ip = `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`) {
  return new NextRequest(`${BASE}/callback/credentials`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", "x-real-ip": ip },
    body: new URLSearchParams({ email, password: "guess", csrfToken: "t", json: "true" }),
  });
}

function context(...nextauth: string[]) {
  return { params: Promise.resolve({ nextauth }) };
}

beforeEach(() => {
  handler.mockReset();
  authLimiter.reset();
  signInFailureLimiter.reset();
});

describe("createFailureLimiter", () => {
  const WINDOW = 1000;

  it("blocks a key at its cap until the oldest failure leaves the window", () => {
    const limiter = createFailureLimiter({ maxFailures: 2, windowMs: WINDOW });
    expect(limiter.start("a", 0).allowed).toBe(true);
    expect(limiter.start("a", 100).allowed).toBe(true);
    expect(limiter.start("a", 200)).toEqual({ allowed: false, retryAfterMs: 800 });
    expect(limiter.start("b", 200).allowed).toBe(true);
    expect(limiter.start("a", 1001).allowed).toBe(true);
  });

  it("takes back a forgiven attempt", () => {
    const limiter = createFailureLimiter({ maxFailures: 1, windowMs: WINDOW });
    const first = limiter.start("a", 0);
    expect(first.allowed).toBe(true);
    if (first.allowed) limiter.forgive("a", first.stamp);
    expect(limiter.start("a", 10).allowed).toBe(true);
    expect(limiter.start("a", 20).allowed).toBe(false);
  });

  it("counts an attempt while it runs, so parallel guesses can't pass the cap", () => {
    const limiter = createFailureLimiter({ maxFailures: 3, windowMs: WINDOW });
    const started = [0, 0, 0, 0, 0].map(() => limiter.start("a", 5));
    expect(started.filter((attempt) => attempt.allowed)).toHaveLength(3);
  });
});

describe("readSignInEmail", () => {
  it("reads the last email in a form body, as next-auth does", async () => {
    const request = new Request(`${BASE}/callback/credentials`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "email=decoy%40example.com&email=%20Me%40Example.com%20&password=x",
    });
    expect(await readSignInEmail(request)).toBe("me@example.com");
    // The body is still there for next-auth.
    expect(await request.text()).toContain("password=x");
  });

  it("reads a JSON body and ignores anything that isn't an email string", async () => {
    const json = (body: string) =>
      new Request(BASE, { method: "POST", headers: { "content-type": "application/json" }, body });
    expect(await readSignInEmail(json('{"email":"A@B.co"}'))).toBe("a@b.co");
    expect(await readSignInEmail(json('{"email":["a@b.co"]}'))).toBeNull();
    expect(await readSignInEmail(json("not json"))).toBeNull();
  });
});

describe("signInErrorCode", () => {
  it("reads the code from a JSON answer or a redirect", async () => {
    expect(await signInErrorCode(nextAuthAnswer(FAILED, 401))).toBe("CredentialsSignin");
    expect(await signInErrorCode(nextAuthAnswer("http://localhost:3000/", 200))).toBeNull();
    const redirect = new Response(null, { status: 302, headers: { location: `${BASE}/error?error=EmailNotVerified` } });
    expect(await signInErrorCode(redirect)).toBe("EmailNotVerified");
  });
});

describe("POST /api/auth/[...nextauth]", () => {
  it("never limits sign-out or session updates", async () => {
    handler.mockResolvedValue(new Response(null, { status: 200 }));
    for (let i = 0; i < 150; i++) {
      const res = await POST(signInRequest("me@example.com", "10.2.0.1"), context("signout"));
      expect(res.status).toBe(200);
    }
    const res = await POST(signInRequest("me@example.com", "10.2.0.1"), context("session"));
    expect(res.status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(151);
  });

  it("limits wrong passwords per account across networks, with a wait", async () => {
    handler.mockImplementation(async () => nextAuthAnswer(FAILED, 401));
    let res: Response | undefined;
    let attempts = 0;
    for (; attempts < 1000; attempts++) {
      const answer: Response = await POST(signInRequest("victim@example.com"), context("callback", "credentials"));
      res = answer;
      if (answer.status === 429) break;
    }
    expect(res?.status).toBe(429);
    expect(Number(res?.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res!.json()).code).toBe("RATE_LIMITED");
    expect(handler).toHaveBeenCalledTimes(attempts);

    // The same email typed differently is the same account.
    expect((await POST(signInRequest(" VICTIM@example.com "), context("callback", "credentials"))).status).toBe(429);
    // Another account is unaffected.
    expect((await POST(signInRequest("me@example.com"), context("callback", "credentials"))).status).toBe(401);
  });

  it("doesn't count right passwords or unverified emails", async () => {
    handler.mockImplementation(async () => nextAuthAnswer("http://localhost:3000/", 200));
    for (let i = 0; i < 400; i++) {
      const res = await POST(signInRequest("me@example.com"), context("callback", "credentials"));
      expect(res.status).toBe(200);
    }
    handler.mockImplementation(async () => nextAuthAnswer(`${BASE}/error?error=EmailNotVerified`, 401));
    for (let i = 0; i < 400; i++) {
      const res = await POST(signInRequest("me@example.com"), context("callback", "credentials"));
      expect(res.status).toBe(401);
    }
  });
});
