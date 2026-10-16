import { NextRequest, NextResponse } from "next/server";
import { redeemToken } from "@/lib/tokens";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { authTokenLimiter, getClientIp } from "@/lib/rate-limit";

/** Where a verification link lands. The page explains each status in plain words. */
type VerifyLinkStatus = "expired" | "invalid" | "busy" | "failed";

function landOn(request: NextRequest, path: string): NextResponse {
  // 303 so a browser always follows with a GET to the page.
  return NextResponse.redirect(new URL(path, request.url), 303);
}

function landOnStatus(request: NextRequest, status: VerifyLinkStatus): NextResponse {
  return landOn(request, `/auth/verify-email?status=${status}`);
}

/**
 * GET /api/auth/verify-email?token=xxx
 * The link in the verification email. It always ends on a page, never on
 * raw JSON: sign-in with a "verified" banner on success, or the
 * verify-email page with a status explaining what went wrong.
 */
export async function GET(request: NextRequest) {
  const rl = authTokenLimiter.check(getClientIp(request));
  if (!rl.allowed) return landOnStatus(request, "busy");

  const token = request.nextUrl.searchParams.get("token");
  if (!token) return landOnStatus(request, "invalid");

  try {
    const state = await redeemToken(token, "EMAIL_VERIFY");

    if (state.status === "valid") {
      await prisma.user.update({
        where: { id: state.userId },
        data: { emailVerified: new Date() },
      });
      logger.info("email.verified", { userId: state.userId });
      return landOn(request, "/auth/signin?verified=true");
    }

    if (state.status === "used") {
      // Opened twice, or replaced by a newer link. If the account is already
      // verified there's nothing left to do but sign in.
      const user = await prisma.user.findUnique({
        where: { id: state.userId },
        select: { emailVerified: true },
      });
      if (user?.emailVerified) return landOn(request, "/auth/signin?verified=true");
      return landOnStatus(request, "invalid");
    }

    return landOnStatus(request, state.status);
  } catch (err) {
    logger.error("email.verify_failed", { error: String(err) });
    return landOnStatus(request, "failed");
  }
}
