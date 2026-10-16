import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { encryptToken } from "@/lib/crypto/token-vault";
import { logger } from "@/lib/logger";
import { getBaseUrl } from "@/lib/config";

// The OAuth flow starts from the settings page, so every outcome lands back
// there: ?google=connected on success, ?google=error&reason=<code> otherwise.
function settingsRedirect(outcome: { connected: true } | { error: string }) {
  const params = new URLSearchParams(
    "error" in outcome
      ? { google: "error", reason: outcome.error }
      : { google: "connected" },
  );
  return NextResponse.redirect(`${getBaseUrl()}/settings?${params.toString()}`, 302);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const baseUrl = getBaseUrl();

  if (error) {
    return settingsRedirect({ error });
  }

  if (!code || !state) {
    return settingsRedirect({ error: "missing_params" });
  }

  // The tokens belong to whoever is signed in here, never to whoever started
  // the flow: otherwise an attacker could send a victim their own consent
  // link (carrying the attacker's state) and receive the victim's calendar.
  const userId = await getUserId(request);
  if (!userId) {
    return settingsRedirect({ error: "invalid_state" });
  }

  // Claim the state in one statement: it must exist, be unexpired and have
  // been issued to this same user. Two concurrent callbacks can't both win.
  const { count } = await prisma.oAuthState.deleteMany({
    where: { state, userId, expiresAt: { gt: new Date() } },
  });
  if (count !== 1) {
    return settingsRedirect({ error: "invalid_state" });
  }

  // Exchange code for tokens
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI
    || `${baseUrl}/api/integrations/google/callback`;

  if (!clientId || !clientSecret) {
    return settingsRedirect({ error: "not_configured" });
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
      signal: AbortSignal.timeout(10_000),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      logger.error("google_token_exchange_failed", { error: String(errBody) });
      return settingsRedirect({ error: "token_exchange_failed" });
    }

    const tokens = await tokenRes.json();
    const accessToken = tokens.access_token as string;
    const refreshToken = tokens.refresh_token as string | undefined;
    const expiresIn = (tokens.expires_in as number) || 3600;
    const scope = (tokens.scope as string) || "";

    if (!refreshToken) {
      return settingsRedirect({ error: "no_refresh_token" });
    }

    // Fetch connected email via userinfo
    let connectedEmail: string | null = null;
    try {
      const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(5_000),
      });
      if (userinfoRes.ok) {
        const info = await userinfoRes.json();
        connectedEmail = (info.email as string) || null;
      }
    } catch {
      // Non-critical: the email is only shown in Settings.
    }

    // Encrypt and store tokens
    const accessTokenEncrypted = encryptToken(accessToken);
    const refreshTokenEncrypted = encryptToken(refreshToken);
    const tokenExpiryMs = BigInt(Date.now() + expiresIn * 1000);

    await prisma.googleIntegration.upsert({
      where: { userId },
      create: {
        userId,
        status: "CONNECTED",
        connectedEmail,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiryMs,
        scopeString: scope,
        lastHealthyAt: new Date(),
      },
      update: {
        status: "CONNECTED",
        connectedEmail,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        tokenExpiryMs,
        scopeString: scope,
        lastErrorCode: null,
        lastErrorMessage: null,
        lastHealthyAt: new Date(),
      },
    });

    return settingsRedirect({ connected: true });
  } catch (err) {
    logger.error("google_oauth_callback_failed", { error: String(err) });
    return settingsRedirect({ error: "internal" });
  }
}
