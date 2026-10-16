import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { CREDENTIALS_SIGNIN, readSignInEmail, signInErrorCode, signInFailureLimiter } from "../_lib/limits";
import { KNOWN_DEVICE_COOKIE, isKnownDevice, startsSession, withKnownDevice } from "../_lib/known-device";

const nextAuth = NextAuth(authOptions);

type Context = { params: Promise<{ nextauth: string[] }> };

/**
 * The POST actions that check a password. Sign-out, session updates and
 * client logs pass through unlimited, so they never use up sign-in attempts.
 */
const SIGN_IN_ACTIONS = new Set(["signin", "callback"]);

// GET passes through (CSRF token, providers, session, etc.)
export { nextAuth as GET };

/**
 * POST carries sign-in attempts, sign-out and session updates. Password
 * attempts are limited per network, and wrong passwords per account. A
 * browser that has signed in to the account before skips the per-account
 * limit, so a stranger tripping it can't lock the student out.
 */
export async function POST(request: NextRequest, context: Context) {
  const [action, provider] = (await context.params).nextauth ?? [];
  if (!SIGN_IN_ACTIONS.has(action)) return nextAuth(request, context);

  const ip = authLimiter.check(getClientIp(request));
  if (!ip.allowed) return tooManyRequests(ip.retryAfterMs);

  const email = action === "callback" && provider === "credentials" ? await readSignInEmail(request) : null;
  if (!email) return nextAuth(request, context);

  if (isKnownDevice(request.cookies.get(KNOWN_DEVICE_COOKIE)?.value, email)) {
    const response = await nextAuth(request, context);
    return startsSession(response) ? withKnownDevice(response, email) : response;
  }

  const attempt = signInFailureLimiter.start(email);
  if (!attempt.allowed) return tooManyRequests(attempt.retryAfterMs);

  let response: Response;
  try {
    response = await nextAuth(request, context);
  } catch (err) {
    signInFailureLimiter.forgive(email, attempt.stamp);
    throw err;
  }
  // Only a wrong email or password counts against the account.
  if ((await signInErrorCode(response)) !== CREDENTIALS_SIGNIN) {
    signInFailureLimiter.forgive(email, attempt.stamp);
  }
  return startsSession(response) ? withKnownDevice(response, email) : response;
}
