/**
 * Public, non-secret runtime flags, read at request time. Shared by
 * GET /api/config and server components (Settings) so both agree.
 */
export interface PublicConfig {
  /** Email verification gates sign-in (REQUIRE_EMAIL_VERIFICATION). */
  verification_required: boolean;
  /** The AI provider is the deterministic mock (AI_PROVIDER unset or "mock"). */
  ai_mock: boolean;
  /** "mock" or "openai". */
  ai_provider: string;
  /** The AI kill switch is on (AI_DISABLED=true). */
  ai_disabled: boolean;
  /** Google Calendar OAuth has a client id on this server. */
  google_configured: boolean;
}

export function publicConfig(): PublicConfig {
  const aiProvider = process.env.AI_PROVIDER || "mock";
  return {
    verification_required: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    ai_mock: aiProvider === "mock",
    ai_provider: aiProvider,
    ai_disabled: process.env.AI_DISABLED === "true",
    google_configured: Boolean(process.env.GOOGLE_CLIENT_ID),
  };
}
