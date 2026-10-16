import type { NextAuthOptions } from "next-auth";
import type { JWT } from "next-auth/jwt";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "crypto";
import { prisma } from "./db";
import { logger } from "./logger";
import { EMAIL_NOT_VERIFIED } from "@/lib/auth-messages";

// Secure cookies must follow the actual serving protocol, not the build
// mode: a production build served over plain http (e.g. `npm start` on
// localhost) would set Secure cookies the browser silently drops, making
// sign-in impossible. Browsers only honor the __Secure- prefix over https.
// Exported for the other cookies the auth routes set.
export const SECURE_COOKIES =
  process.env.NEXTAUTH_URL?.startsWith("https://") ??
  process.env.NODE_ENV === "production";

/** The session cookie; its arrival on a sign-in response means the password matched. */
export const SESSION_COOKIE_NAME = SECURE_COOKIES
  ? "__Secure-next-auth.session-token"
  : "next-auth.session-token";

/** bcrypt cost for every stored password hash (sign-up and reset). */
export const BCRYPT_COST = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

// An unknown email must cost the same bcrypt work as a wrong password, or
// sign-in timing shows which emails have accounts. bcrypt.compare returns
// false at once for a malformed hash, so the stand-in has to be a real hash
// at the stored cost. Computed once per process, on the first sign-in.
let dummyHash: Promise<string> | undefined;

/** A real bcrypt hash of a random secret, at BCRYPT_COST. Exported for tests. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

/**
 * A short digest of the stored password hash. It rides in the (encrypted)
 * session token, so a password reset changes it and ends every session
 * signed in with the old password.
 */
export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

/** How often a session re-reads the account to see if it still stands. */
export const SESSION_RECHECK_MS = 5 * 60 * 1000;

/**
 * Thrown from the jwt callback when the account is gone or its password
 * changed. next-auth then answers with no session and clears the cookie on
 * /api/auth/session, and getServerSession returns null.
 */
export const SESSION_REVOKED = "SessionRevoked";

type SessionToken = JWT & {
  /** passwordFingerprint at sign-in. */
  pv?: string;
};

type SignedInUser = { id: string; email: string; name: string | null; pv: string };

// When each account last matched its stored password, per process (the app
// runs as one server). The throttle lives here rather than in the token:
// server components can't rewrite the session cookie, so a time stamped
// into the token would go stale and every request would hit the database.
const lastConfirmed = new Map<string, { pv: string; at: number }>();

/**
 * Forget an account's last check, so its next request re-reads it. Call
 * after changing a password or deleting an account to end old sessions now
 * instead of within SESSION_RECHECK_MS.
 */
export function forgetSessionCheck(userId: string): void {
  lastConfirmed.delete(userId);
}

/**
 * Keep a session only while its account exists with the password it signed
 * in with. Tokens from before this check (no fingerprint) are ended too, so
 * every session that predates a reset is covered. Exported for tests.
 */
export async function refreshSessionToken(token: SessionToken, now: number = Date.now()): Promise<SessionToken> {
  if (!token.id || !token.pv) throw new Error(SESSION_REVOKED);
  const last = lastConfirmed.get(token.id);
  if (last && last.pv === token.pv && now - last.at < SESSION_RECHECK_MS) return token;

  let user: { passwordHash: string } | null;
  try {
    user = await prisma.user.findUnique({
      where: { id: token.id },
      select: { passwordHash: true },
    });
  } catch (err) {
    // A database hiccup must not sign the student out (the session route
    // would clear the cookie). Nothing is recorded, so the next request
    // checks again.
    logger.warn("auth.session_check_failed", { error: String(err) });
    return token;
  }
  if (!user || passwordFingerprint(user.passwordHash) !== token.pv) {
    lastConfirmed.delete(token.id);
    throw new Error(SESSION_REVOKED);
  }
  lastConfirmed.set(token.id, { pv: token.pv, at: now });
  return token;
}

/** True when sign-in waits for a verified email (REQUIRE_EMAIL_VERIFICATION). */
export function isEmailVerificationRequired(): boolean {
  return process.env.REQUIRE_EMAIL_VERIFICATION === "true";
}

export const authOptions: NextAuthOptions = {
  session: {
    strategy: "jwt",
    maxAge: 7 * 24 * 60 * 60,  // 7 days
    updateAge: 24 * 60 * 60,   // refresh token every 24h
  },
  cookies: {
    sessionToken: {
      name: SESSION_COOKIE_NAME,
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: SECURE_COOKIES,
      },
    },
  },
  pages: {
    signIn: "/auth/signin",
    newUser: "/auth/signup",
    // next-auth's own error page is unstyled; the sign-in page reads the
    // ?error= code and shows it in plain words instead.
    error: "/auth/signin",
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        // Started before the lookup so the first attempt after a restart
        // pays for it whether or not the account exists.
        const fallbackHash = getDummyHash();
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.toLowerCase().trim() },
        });

        // Always run a full bcrypt.compare, against a real dummy hash when
        // the account doesn't exist, so timing doesn't reveal accounts.
        const valid = await bcrypt.compare(
          credentials.password,
          user?.passwordHash ?? (await fallbackHash),
        );
        if (!user || !valid) return null;

        // Single-user app: verifying your own email to yourself protects
        // nothing, and this gate once locked the owner out of a local
        // production build. Opt in only when real SMTP can deliver links.
        // Throwing (instead of returning null) sends the code to the sign-in
        // form, which then offers a new verification link instead of saying
        // the password is wrong. It only fires after the password matched.
        if (isEmailVerificationRequired() && !user.emailVerified) {
          throw new Error(EMAIL_NOT_VERIFIED);
        }

        const signedIn: SignedInUser = {
          id: user.id,
          email: user.email,
          name: user.name,
          pv: passwordFingerprint(user.passwordHash),
        };
        return signedIn;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        // Sign-in: `user` is what authorize returned, read from the
        // database a moment ago.
        const { id, pv } = user as Partial<SignedInUser>;
        if (id && pv) lastConfirmed.set(id, { pv, at: Date.now() });
        return { ...token, id, pv };
      }
      return refreshSessionToken(token);
    },
    async session({ session, token }) {
      if (token && session.user) {
        (session.user as { id?: string }).id = token.id as string;
      }
      return session;
    },
  },
};
