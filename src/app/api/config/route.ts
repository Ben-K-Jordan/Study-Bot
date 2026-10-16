import { NextResponse } from "next/server";
import { publicConfig } from "@/lib/public-config";

// Env-derived flags must be read at request time, not baked in at build.
export const dynamic = "force-dynamic";

/**
 * GET /api/config: public, non-secret runtime flags for the UI.
 *
 * - verification_required: whether email verification gates sign-in
 *   (opt-in via REQUIRE_EMAIL_VERIFICATION, see src/lib/auth-options.ts).
 * - ai_mock / ai_provider: whether the AI provider factory resolves to the
 *   mock provider (AI_PROVIDER unset or "mock", see src/lib/ai/provider-factory.ts).
 * - ai_disabled: the AI kill switch (AI_DISABLED=true, see src/lib/ai/gateway.ts).
 * - google_configured: Google Calendar can be connected (the fake provider,
 *   or OAuth with a client id; see src/lib/google/availability.ts).
 * - email_configured: emails go out over SMTP.
 * - email_links_available: password reset and verification links can reach
 *   the student (SMTP, or the terminal in development). Screens that would
 *   promise an email check this first.
 */
export async function GET() {
  return NextResponse.json(publicConfig());
}
