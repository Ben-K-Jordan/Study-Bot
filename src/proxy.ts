import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { testAuthUserId } from "@/lib/test-auth";
import { unauthorized } from "@/lib/http";

// One-time flag: warn loudly if the test-auth header is trusted in a
// production build (only possible with CI=true) so it can't go unnoticed.
let warnedTestAuthInProduction = false;

const PUBLIC_PATHS = [
  "/auth/signin",
  "/auth/signup",
  "/auth/verify-email",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/api/auth",
  "/api/config", // non-secret runtime flags; signup reads it before a session exists
  "/api/health",
];

// Files served from public/ and app metadata routes (icon.svg, manifest.json).
// All of them sit at the top level, so only a single-segment path matches:
// /flashcards/abc.json is a page under a dynamic segment and still needs a
// session. Checked outside /api only, so an API path can never skip auth.
const STATIC_FILE = /^\/[^/]+\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Body of the 403 for a write sent from another site; clients branch on `code`. */
const CROSS_SITE_BODY = {
  error: "Request blocked because it came from another site. Reload the page and retry.",
  code: "CROSS_SITE_REQUEST",
} as const;

function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Reject state-changing API requests sent by another site (CSRF defense on
 * top of the SameSite=Lax session cookie). Browsers send Origin on every
 * cross-origin POST/PUT/PATCH/DELETE; requests without it (curl, server to
 * server, the e2e request client) fall back to Sec-Fetch-Site and are
 * otherwise allowed, since they carry no ambient browser cookies.
 */
function isCrossSiteWrite(request: NextRequest): boolean {
  if (SAFE_METHODS.has(request.method)) return false;

  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "cross-site";

  const originUrl = originOf(origin);
  if (!originUrl) return true; // "null" or garbage

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host && new URL(originUrl).host === host) return false;

  const allowed = [request.nextUrl.origin, originOf(process.env.BASE_URL), originOf(process.env.NEXTAUTH_URL)];
  return !allowed.includes(originUrl);
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  if (isApi && isCrossSiteWrite(request)) {
    return NextResponse.json(CROSS_SITE_BODY, { status: 403 });
  }

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    (!isApi && STATIC_FILE.test(pathname))
  ) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // X-User-Id header stands in for a session only when test auth is enabled
  if (!token && testAuthUserId(request.headers)) {
    if (process.env.NODE_ENV === "production" && !warnedTestAuthInProduction) {
      warnedTestAuthInProduction = true;
      // Proxy runs apart from the route code, so it logs with console.warn instead of the structured logger
      console.warn(
        "auth.test_auth_active_in_production: X-User-Id header is being trusted as identity because ALLOW_TEST_AUTH=true and CI=true. This must never be enabled in a real deployment.",
      );
    }
    return NextResponse.next();
  }

  if (!token) {
    // API routes get 401 JSON instead of redirect
    if (isApi) return unauthorized();
    const signInUrl = new URL("/auth/signin", request.url);
    // Keep the query (/plan?plan=abc) so sign-in returns to the same view
    signInUrl.searchParams.set("callbackUrl", pathname + request.nextUrl.search);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
