import NextAuth from "next-auth";
import { NextRequest } from "next/server";
import { authOptions } from "@/lib/auth-options";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";

const nextAuth = NextAuth(authOptions);

// GET passes through (CSRF token, providers, etc.)
export { nextAuth as GET };

// POST is rate-limited (handles login attempts)
export async function POST(request: NextRequest, context: any) {
  const rl = authLimiter.check(getClientIp(request));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);
  return nextAuth(request, context);
}
