import { NextResponse } from "next/server";

// Env-derived flags must be read at request time, not baked in at build.
export const dynamic = "force-dynamic";

/**
 * GET /api/config — public, non-secret runtime flags for the UI.
 *
 * - verification_required: whether email verification gates sign-in
 *   (opt-in via REQUIRE_EMAIL_VERIFICATION, see src/lib/auth-options.ts).
 * - ai_mock: whether the AI provider factory resolves to the mock provider
 *   (AI_PROVIDER unset or "mock", see src/lib/ai/provider-factory.ts).
 */
export async function GET() {
  return NextResponse.json({
    verification_required: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    ai_mock: (process.env.AI_PROVIDER || "mock") === "mock",
  });
}
