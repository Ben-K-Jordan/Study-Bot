/**
 * Unit tests for the credentials sign-in in src/lib/auth-options.ts:
 * wrong details return null (next-auth's CredentialsSignin), an unverified
 * email throws a code the sign-in form explains, and next-auth errors land
 * on the styled sign-in page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { findUnique } = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findUnique } } }));
vi.mock("bcryptjs", () => ({
  default: { compare: vi.fn(async (password: string) => password === "right-password") },
}));

import { authOptions } from "@/lib/auth-options";
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
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("credentials authorize", () => {
  it("returns the user for the right password", async () => {
    findUnique.mockResolvedValue(user);
    expect(await authorize({ email: " Me@Example.com ", password: "right-password" })).toEqual({
      id: "u1",
      email: "me@example.com",
      name: "Me",
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

describe("pages", () => {
  it("sends next-auth errors to the sign-in page", () => {
    expect(authOptions.pages?.signIn).toBe("/auth/signin");
    expect(authOptions.pages?.error).toBe("/auth/signin");
  });
});
