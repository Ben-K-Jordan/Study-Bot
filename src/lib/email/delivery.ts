/**
 * Whether auth emails (password reset and verification links) actually
 * reach the student. Only the SMTP provider delivers mail; the console
 * provider, the default, prints it to the server log.
 */
export function isEmailDeliveryConfigured(): boolean {
  return process.env.EMAIL_PROVIDER === "smtp";
}
