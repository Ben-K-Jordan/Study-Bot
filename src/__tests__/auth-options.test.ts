/**
 * Unit tests for the credentials sign-in in src/lib/auth-options.ts:
 * wrong details return null (next-auth's CredentialsSignin), an unverified
 * email throws a code the sign-in form explains, an unknown email costs a
 * full bcrypt compare, next-auth errors land on the styled sign-in page, and
 * a session ends once its account is deleted or its password changes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { findUnique, compare } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  compare: vi.fn(async (password: string) => password === "right-password"),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
// Real hashing (for the dummy hash), stubbed compare (for speed and control).
vi.mock("bcryptjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("bcryptjs")>();
  return { default: { ...actual.default, compare } };
});

import bcrypt from "bcryptjs";
import { encode, type JWT } from "next-auth/jwt";
import { getServerSession } from "next-auth";
import {
  BCRYPT_COST,
  SESSION_RECHECK_MS,
  SESSION_REVOKED,
  authOptions,
  forgetSessionCheck,
  getDummyHash,
  passwordFingerprint,
  refreshSessionToken,
} from "@/lib/auth-options";
import { EMAIL_NOT_VERIFIED } from "@/components/auth/messages";

type Authorize = (credentials: Record<string, string> | undefined) => Promise<unknown>;

function authorize(credentials: Record<string, string> | undefined) {
  const provider = authOptions.providers[0] as unknown as { options: { authorize: Authorize } };
  return provider.options.authorize(credentials);
}

const user = {
  id: "u1",
  email: "me@example.com",
  name: "Me",
  passwordHash: "hash",
  emailVerified: null as Date | null,
};

beforeEach(() => {
  findUnique.mockReset();
  compare.mockClear();
  forgetSessionCheck("u1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credentials authorize", () => {
  it("returns the user and a password fingerprint for the right password", async () => {
    findUnique.mockResolvedValue(user);
    expect(await authorize({ email: " Me@Example.com ", password: "right-password" })).toEqual({
      id: "u1",
      email: "me@example.com",
      name: "Me",
      pv: passwordFingerprint("hash"),
    });
    expect(findUnique).toHaveBeenCalledWith({ where: { email: "me@example.com" } });
  });

  it("returns null for a wrong password, an unknown email or missing fields", async () => {
    findUnique.mockResolvedValue(user);
    expect(await authorize({ email: "me@example.com", password: "wrong" })).toBeNull();
    findUnique.mockResolvedValue(null);
    expect(await authorize({ email: "nobody@example.com", password: "right-password" })).toBeNull();
    expect(await authorize(undefined)).toBeNull();
  });

  it("throws EmailNotVerified only when verification is required and the password matched", async () => {
    vi.stubEnv("REQUIRE_EMAIL_VERIFICATION", "true");
    findUnique.mockResolvedValue(user);
    await expect(authorize({ email: "me@example.com", password: "right-password" })).rejects.toThrow(
      EMAIL_NOT_VERIFIED,
    );
    expect(await authorize({ email: "me@example.com", password: "wrong" })).toBeNull();

    findUnique.mockResolvedValue({ ...user, emailVerified: new Date() });
    expect(await authorize({ email: "me@example.com", password: "right-password" })).toMatchObject({ id: "u1" });
  });
});

describe("unknown emails", () => {
  it("compare against a real bcrypt hash at the stored cost", async () => {
    const dummy = await getDummyHash();
    expect(bcrypt.getRounds(dummy)).toBe(BCRYPT_COST);
    expect(dummy).toHaveLength(60);
    expect(await getDummyHash()).toBe(dummy);
  }, 20_000);

  it("run the full compare, not a shortcut", async () => {
    findUnique.mockResolvedValue(null);
    await authorize({ email: "nobody@example.com", password: "guess" });
    expect(compare).toHaveBeenCalledWith("guess", await getDummyHash());
  }, 20_000);
});

describe("refreshSessionToken", () => {
  const NOW = 1_800_000_000_000;
  const token = (pv: string = passwordFingerprint("hash")): JWT => ({ id: "u1", pv }) as JWT;

  it("ends sessions with no account id or fingerprint (tokens from before the check)", async () => {
    await expect(refreshSessionToken({} as JWT, NOW)).rejects.toThrow(SESSION_REVOKED);
    await expect(refreshSessionToken({ id: "u1" } as JWT, NOW)).rejects.toThrow(SESSION_REVOKED);
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("keeps a session while the password is unchanged, re-reading at most every 5 minutes", async () => {
    findUnique.mockResolvedValue({ passwordHash: "hash" });
    expect(await refreshSessionToken(token(), NOW)).toMatchObject({ id: "u1" });
    await refreshSessionToken(token(), NOW + SESSION_RECHECK_MS - 1);
    expect(findUnique).toHaveBeenCalledOnce();
    await refreshSessionToken(token(), NOW + SESSION_RECHECK_MS);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("ends a session after a password change or account deletion", async () => {
    findUnique.mockResolvedValueOnce({ passwordHash: "new-hash" });
    await expect(refreshSessionToken(token(), NOW)).rejects.toThrow(SESSION_REVOKED);
    findUnique.mockResolvedValueOnce(null);
    await expect(refreshSessionToken(token(), NOW)).rejects.toThrow(SESSION_REVOKED);
  });

  it("re-reads at once after forgetSessionCheck", async () => {
    findUnique.mockResolvedValueOnce({ passwordHash: "hash" });
    await refreshSessionToken(token(), NOW);
    forgetSessionCheck("u1");
    findUnique.mockResolvedValueOnce({ passwordHash: "new-hash" });
    await expect(refreshSessionToken(token(), NOW + 1000)).rejects.toThrow(SESSION_REVOKED);
  });

  it("keeps the session through a database failure and checks again next time", async () => {
    findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await refreshSessionToken(token(), NOW)).toMatchObject({ id: "u1" });
    findUnique.mockResolvedValueOnce({ passwordHash: "hash" });
    await refreshSessionToken(token(), NOW + 1000);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("getServerSession with a revoked token", () => {
  const SECRET = "test-secret-for-session-revocation";
  const COOKIE = "next-auth.session-token";

  async function readSession(pv: string) {
    vi.stubEnv("NEXTAUTH_SECRET", SECRET);
    const jwe = await encode({ token: { sub: "u1", id: "u1", pv, email: "me@example.com" }, secret: SECRET });
    const headers = new Map<string, string[]>();
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      setHeader: (name: string, value: string[]) => headers.set(name.toLowerCase(), value),
    };
    const req = { headers: { host: "localhost:3000" }, cookies: { [COOKIE]: jwe } };
    const session = await getServerSession(req as never, res as never, authOptions);
    return { session, setCookies: headers.get("set-cookie") ?? [] };
  }

  it("returns the session while the password matches", async () => {
    findUnique.mockResolvedValue({ passwordHash: "hash" });
    const { session } = await readSession(passwordFingerprint("hash"));
    expect(session?.user).toMatchObject({ id: "u1" });
  });

  it("returns null and clears the cookie once the password changed", async () => {
    findUnique.mockResolvedValue({ passwordHash: "new-hash" });
    const { session, setCookies } = await readSession(passwordFingerprint("hash"));
    expect(session).toBeNull();
    const cleared = setCookies.find((cookie) => cookie.startsWith(`${COOKIE}=;`));
    expect(cleared).toMatch(/Max-Age=0/i);
  });
});

describe("pages", () => {
  it("sends next-auth errors to the sign-in page", () => {
    expect(authOptions.pages?.signIn).toBe("/auth/signin");
    expect(authOptions.pages?.error).toBe("/auth/signin");
  });
});
