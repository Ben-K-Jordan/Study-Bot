import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { randomBytes } from "crypto";
import { getBaseUrl } from "@/lib/config";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/userinfo.email",
].join(" ");

/** The connection the fake provider answers for; its token is never decrypted or sent. */
async function connectFakeGoogle(userId: string): Promise<void> {
  const connection = {
    status: "CONNECTED",
    connectedEmail: "test@example.com",
    refreshTokenEncrypted: "fake-encrypted-token",
    tokenExpiryMs: BigInt(Date.now() + 3600_000),
    scopeString: GOOGLE_SCOPES,
    lastErrorCode: null,
    lastErrorMessage: null,
    lastHealthyAt: new Date(),
  };
  await prisma.googleIntegration.upsert({
    where: { userId },
    create: { userId, ...connection },
    update: connection,
  });
}

/**
 * GET /api/integrations/google/connect: starts Google's OAuth consent flow.
 * The Settings page links here with a full-page navigation, so every
 * failure redirects to a page with a message instead of answering JSON.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    const signIn = new URLSearchParams({ callbackUrl: "/settings#calendar" });
    return NextResponse.redirect(`${getBaseUrl()}/auth/signin?${signIn.toString()}`, 302);
  }

  // With the in-memory fake provider (development and tests) there is no
  // real Google account to consent with, and tokens from one would never be
  // used. Connect to the fake calendar directly and land where the real
  // callback would.
  if (process.env.GOOGLE_PROVIDER === "fake") {
    await connectFakeGoogle(userId);
    const params = new URLSearchParams({ google: "connected" });
    return NextResponse.redirect(`${getBaseUrl()}/settings?${params.toString()}`, 302);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || `${getBaseUrl()}/api/integrations/google/callback`;

  if (!clientId) {
    const params = new URLSearchParams({ google: "error", reason: "not_configured" });
    return NextResponse.redirect(`${getBaseUrl()}/settings?${params.toString()}`, 302);
  }

  // Generate state token and persist
  const state = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Clean up any expired states for this user
  await prisma.oAuthState.deleteMany({
    where: { userId, expiresAt: { lt: new Date() } },
  });

  await prisma.oAuthState.create({
    data: { state, userId, expiresAt },
  });

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline",
    prompt: "consent",
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  return NextResponse.redirect(url, 302);
}
