import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// One-time flag: warn loudly if the test-auth header path is exercised in a
// production build (ALLOW_TEST_AUTH=true) so it can't be silently left on.
let warnedTestAuthInProduction = false;

const PUBLIC_PATHS = [
  "/auth/signin",
  "/auth/signup",
  "/auth/verify-email",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/api/auth",
  "/api/health",
  "/s/", // Session links are shareable; API-level auth guards operations
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/sw.js") ||
    pathname.startsWith("/favicon") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  // Allow requests with X-User-Id header — ONLY in non-production or explicit test mode
  if (
    !token &&
    (process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_AUTH === "true") &&
    request.headers.get("x-user-id")
  ) {
    if (
      process.env.NODE_ENV === "production" &&
      process.env.ALLOW_TEST_AUTH === "true" &&
      !warnedTestAuthInProduction
    ) {
      warnedTestAuthInProduction = true;
      // Middleware runs on the edge runtime; console.warn instead of the structured logger
      console.warn(
        "auth.test_auth_active_in_production: X-User-Id header is being trusted as identity because ALLOW_TEST_AUTH=true. This must never be enabled in a real deployment.",
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
