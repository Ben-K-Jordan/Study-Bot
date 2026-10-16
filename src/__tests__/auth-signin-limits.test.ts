/**
 * Unit tests for the sign-in limits in src/app/api/auth/[...nextauth]/route.ts
 * and src/app/api/auth/_lib/limits.ts: wrong passwords count per account
 * from any network, right passwords and sign-out never use up attempts,
 * the limiter reads the same email next-auth checks, and a browser that
 * signed in to the account before (known-device.ts) can't be locked out.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const { handler } = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("next-auth", () => ({ default: () => handler }));
vi.mock("@/lib/auth-options", () => ({
  authOptions: {},
  SECURE_COOKIES: false,
  SESSION_COOKIE_NAME: "next-auth.session-token",
}));

import { POST } from "@/app/api/auth/[...nextauth]/route";
import {
  createFailureLimiter,
  readSignInEmail,
  signInErrorCode,
  signInFailureLimiter,
} from "@/app/api/auth/_lib/limits";
import {
  KNOWN_DEVICE_COOKIE,
  KNOWN_DEVICE_MAX_AGE_S,
  isKnownDevice,
  knownDeviceValue,
} from "@/app/api/auth/_lib/known-device";
import { authLimiter } from "@/lib/rate-limit";

const BASE = "http://localhost:3000/api/auth";
const FAILED = `${BASE}/error?error=CredentialsSignin&provider=credentials`;

function nextAuthAnswer(url: string, status: number) {
  return new Response(JSON.stringify({ url }), { status, headers: { "content-type": "application/json" } });
}

let ipCounter = 0;
function signInRequest(
  email: string,
  ip = `10.1.${Math.floor(++ipCounter / 250)}.${ipCounter % 250}`,
  cookie?: string,
) {
  return new NextRequest(`${BASE}/callback/credentials`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-real-ip": ip,
      ...(cookie ? { cookie } : {}),
    },
    body: new URLSearchParams({ email, password: "guess", csrfToken: "t", json: "true" }),
  });
}

/** next-auth's answer to a right password: the session cookie and the callback URL. */
function signedInAnswer() {
  const headers = new Headers({ "content-type": "application/json" });
  headers.append("Set-Cookie", "next-auth.session-token=jwt; Path=/; HttpOnly; SameSite=Lax");
  headers.append("Set-Cookie", "next-auth.callback-url=%2F; Path=/; SameSite=Lax");
  return new Response(JSON.stringify({ url: "http://localhost:3000/" }), { status: 200, headers });
}

/** The known-device cookie a response set, as a request Cookie header. */
function knownDeviceFrom(response: Response): string | undefined {
  const header = response.headers.getSetCookie().find((c) => c.startsWith(`${KNOWN_DEVICE_COOKIE}=`));
  return header?.split(";", 1)[0];
}

function context(...nextauth: string[]) {
  return { params: Promise.resolve({ nextauth }) };
}

beforeEach(() => {
  handler.mockReset();
  authLimiter.reset();
  signInFailureLimiter.reset();
  vi.stubEnv("NEXTAUTH_SECRET", "unit-test-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
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

  it("clears one key and leaves the others", () => {
    const limiter = createFailureLimiter({ maxFailures: 1, windowMs: WINDOW });
    limiter.start("a", 0);
    limiter.start("b", 0);
    limiter.clear("a");
    expect(limiter.start("a", 10).allowed).toBe(true);
    expect(limiter.start("b", 10).allowed).toBe(false);
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

describe("known-device cookies", () => {
  const NOW = Date.parse("2026-10-16T12:00:00Z");

  it("verifies only for the account and server it was made for, and only for 90 days", () => {
    const value = knownDeviceValue("me@example.com", NOW)!;
    expect(value).toMatch(/^v1\.\d+\.[\w-]+$/);
    expect(isKnownDevice(value, "me@example.com", NOW)).toBe(true);
    expect(isKnownDevice(value, "me@example.com", NOW + (KNOWN_DEVICE_MAX_AGE_S - 60) * 1000)).toBe(true);
    expect(isKnownDevice(value, "me@example.com", NOW + (KNOWN_DEVICE_MAX_AGE_S + 60) * 1000)).toBe(false);
    expect(isKnownDevice(value, "victim@example.com", NOW)).toBe(false);

    const [version, issued, mac] = value.split(".");
    // A changed issue time breaks the signature, so the 90 days can't be stretched.
    expect(isKnownDevice(`${version}.${Number(issued) + 1}.${mac}`, "me@example.com", NOW)).toBe(false);
    expect(isKnownDevice(`${version}.${issued}.${mac.slice(0, -2)}AA`, "me@example.com", NOW)).toBe(false);
    expect(isKnownDevice("v1.1.x", "me@example.com", NOW)).toBe(false);
    expect(isKnownDevice(undefined, "me@example.com", NOW)).toBe(false);

    vi.stubEnv("NEXTAUTH_SECRET", "another-server");
    expect(isKnownDevice(value, "me@example.com", NOW)).toBe(false);
  });

  it("does nothing without a secret", () => {
    vi.stubEnv("NEXTAUTH_SECRET", "");
    vi.stubEnv("AUTH_SECRET", "");
    expect(knownDeviceValue("me@example.com", NOW)).toBeNull();
    expect(isKnownDevice("v1.1.abc", "me@example.com", NOW)).toBe(false);
  });
});

describe("POST /api/auth/[...nextauth] with a known device", () => {
  /** Trip the account's limit from many networks, as an attacker would. */
  async function lockOut(email: string) {
    handler.mockImplementation(async () => nextAuthAnswer(FAILED, 401));
    for (let i = 0; i < 1000; i++) {
      const res = await POST(signInRequest(email), context("callback", "credentials"));
      if (res.status === 429) return;
    }
    throw new Error("the limit never tripped");
  }

  it("marks the browser after a right password, and only then", async () => {
    handler.mockImplementation(async () => signedInAnswer());
    const res: Response = await POST(signInRequest(" Me@Example.com "), context("callback", "credentials"));
    expect(res.status).toBe(200);
    // next-auth's own cookies and body come through untouched.
    expect(res.headers.getSetCookie().filter((c) => c.startsWith("next-auth."))).toHaveLength(2);
    expect((await res.json()).url).toBe("http://localhost:3000/");
    const set = res.headers.getSetCookie().find((c) => c.startsWith(`${KNOWN_DEVICE_COOKIE}=`))!;
    expect(set).toMatch(/; Path=\/api\/auth; Max-Age=7776000; HttpOnly; SameSite=Lax$/);
    expect(isKnownDevice(knownDeviceFrom(res)!.split("=")[1], "me@example.com")).toBe(true);

    handler.mockImplementation(async () => nextAuthAnswer(FAILED, 401));
    const wrong = await POST(signInRequest("me@example.com"), context("callback", "credentials"));
    expect(knownDeviceFrom(wrong)).toBeUndefined();
  });

  it("lets the student's own browser sign in while a stranger keeps the account limit tripped", async () => {
    handler.mockImplementation(async () => signedInAnswer());
    const cookie = knownDeviceFrom(await POST(signInRequest("victim@example.com"), context("callback", "credentials")))!;

    await lockOut("victim@example.com");
    // A stranger, or a browser that never signed in, still gets 429.
    handler.mockImplementation(async () => signedInAnswer());
    expect((await POST(signInRequest("victim@example.com"), context("callback", "credentials"))).status).toBe(429);

    // The student's browser goes through to the password check.
    const own: Response = await POST(signInRequest("victim@example.com", undefined, cookie), context("callback", "credentials"));
    expect(own.status).toBe(200);
    // Its cookie starts another 90 days.
    expect(knownDeviceFrom(own)).toBeDefined();

    // The cookie names one account: it doesn't lift another account's limit.
    await lockOut("other@example.com");
    handler.mockImplementation(async () => signedInAnswer());
    expect((await POST(signInRequest("other@example.com", undefined, cookie), context("callback", "credentials"))).status).toBe(429);
  });

  it("keeps the per-network limit for a known device", async () => {
    handler.mockImplementation(async () => signedInAnswer());
    const cookie = knownDeviceFrom(await POST(signInRequest("me@example.com"), context("callback", "credentials")))!;
    handler.mockImplementation(async () => nextAuthAnswer(FAILED, 401));
    let status = 0;
    for (let i = 0; i < 1000 && status !== 429; i++) {
      const res: Response = await POST(signInRequest("me@example.com", "10.3.0.1", cookie), context("callback", "credentials"));
      status = res.status;
    }
    expect(status).toBe(429);
  });
});
