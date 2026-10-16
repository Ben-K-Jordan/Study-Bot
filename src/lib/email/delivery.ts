import { isTestAuthEnabled } from "@/lib/test-auth";

/**
 * Whether auth emails (password reset and verification links) actually
 * reach the student. Only the SMTP provider delivers mail; the console
 * provider, the default, prints it to the server log.
 */
export function isEmailDeliveryConfigured(): boolean {
  return process.env.EMAIL_PROVIDER === "smtp";
}

/**
 * Whether the console provider may print an email's body and links.
 * A reset or verification link works like a password, so it may only reach
 * a log that a developer or the e2e suite reads: development, test, or a
 * production build that already trusts test auth (the CI e2e run, where the
 * X-User-Id header signs anyone in anyway). On a real production server the
 * log can reach hosting staff and log drains, so links never go there.
 */
export function mayPrintEmailLinks(): boolean {
  return process.env.NODE_ENV !== "production" || isTestAuthEnabled();
}

/**
 * Whether password reset and verification links can reach the student at
 * all: emailed over SMTP, or printed where a developer reads them. When this
 * is false, screens must not promise an email (Settings, Forgot password,
 * sign-up's "check your email").
 */
export function areEmailLinksAvailable(): boolean {
  return isEmailDeliveryConfigured() || mayPrintEmailLinks();
}
