import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const baseUrl = process.env.BASE_URL || "http://localhost:3000";

  if (error) {
    return NextResponse.redirect(`${baseUrl}/settings/calendar?error=${error}`, 302);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${baseUrl}/settings/calendar?error=missing_params`, 302);
  }

  // Validate state
  const oauthState = await prisma.oAuthState.findUnique({ where: { state } });
  if (!oauthState || oauthState.expiresAt < new Date()) {
    // Clean up expired state
    if (oauthState) await prisma.oAuthState.delete({ where: { id: oauthState.id } });
    return NextResponse.redirect(`${baseUrl}/settings/calendar?error=invalid_state`, 302);
  }

  const userId = oauthState.userId;
  // Delete state (one-time use)
  await prisma.oAuthState.delete({ where: { id: oauthState.id } });

  // Exchange code for tokens
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || `${baseUrl}/api/integrations/google/callback`;

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${baseUrl}/settings/calendar?error=not_configured`, 302);
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error("google_token_exchange_failed", { error: String(errBody) });
      return NextResponse.redirect(`${baseUrl}/settings/calendar?error=token_exchange_failed`, 302);
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token as string;
    const refreshToken = tokens.refresh_token as string | undefined;
    const expiresIn = (tokens.expires_in as number) || 3600;
    const scope = (tokens.scope as string) || "";

    if (!refreshToken) {
      return NextResponse.redirect(`${baseUrl}/settings/calendar?error=no_refresh_token`, 302);
    }

    // Encrypt and store tokens
    const accessTokenEncrypted = encrypt(accessToken);
    const refreshTokenEncrypted = encrypt(refreshToken);
    const tokenExpiryMs = BigInt(Date.now() + expiresIn * 1000);

    await prisma.googleIntegration.upsert({
      where: { userId },
      create: {
        userId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiryMs,
        scopeString: scope,
      },
      update: {
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiryMs,
        scopeString: scope,
      },
    });

    return NextResponse.redirect(`${baseUrl}/settings/calendar?connected=1`, 302);
  } catch (err) {
    logger.error("google_oauth_callback_failed", { error: String(err) });
    return NextResponse.redirect(`${baseUrl}/settings/calendar?error=internal`, 302);
  }
}
