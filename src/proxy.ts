import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { testAuthUserId } from "@/lib/test-auth";

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
  "/s/", // Session links are shareable; API-level auth guards operations
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
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
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const signInUrl = new URL("/auth/signin", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
