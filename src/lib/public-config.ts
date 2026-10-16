/**
 * Public, non-secret runtime flags, read at request time. Shared by
 * GET /api/config, PUT /api/settings and server components (Settings) so
 * they all agree.
 */
import { areEmailLinksAvailable, isEmailDeliveryConfigured } from "@/lib/email/delivery";
import { isGoogleCalendarAvailable } from "@/lib/google/availability";

export interface PublicConfig {
  /** Email verification gates sign-in (REQUIRE_EMAIL_VERIFICATION). */
  verification_required: boolean;
  /** The AI provider is the deterministic mock (AI_PROVIDER unset or "mock"). */
  ai_mock: boolean;
  /** "mock" or "openai". */
  ai_provider: string;
  /** The AI kill switch is on (AI_DISABLED=true). */
  ai_disabled: boolean;
  /**
   * Google Calendar can be connected on this server: the fake provider
   * (GOOGLE_PROVIDER=fake), or OAuth with a client id.
   */
  google_configured: boolean;
  /**
   * Emails (password reset and verification links) are delivered over SMTP.
   * False means they only reach the server log (EMAIL_PROVIDER isn't "smtp").
   */
  email_configured: boolean;
  /**
   * Password reset and verification links can reach the student: emailed
   * over SMTP, or printed in the server's terminal in development. False on
   * a production server without SMTP, where screens must not promise an email.
   */
  email_links_available: boolean;
}

export function publicConfig(): PublicConfig {
  const aiProvider = process.env.AI_PROVIDER || "mock";
  return {
    verification_required: process.env.REQUIRE_EMAIL_VERIFICATION === "true",
    ai_mock: aiProvider === "mock",
    ai_provider: aiProvider,
    ai_disabled: process.env.AI_DISABLED === "true",
    google_configured: isGoogleCalendarAvailable(),
    email_configured: isEmailDeliveryConfigured(),
    email_links_available: areEmailLinksAvailable(),
  };
}
