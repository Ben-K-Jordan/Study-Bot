/**
 * What screens say when password reset links can't reach the student
 * (a production server without SMTP, see areEmailLinksAvailable in
 * ./delivery). Shared by Settings and the auth screens so they agree.
 * Pure, safe on the client.
 */
export const PASSWORD_RESET_UNAVAILABLE = {
  title: "Password reset isn't available",
  description:
    "Password reset by email isn't set up on this server. Ask the person who runs this Study Bot to reset your password.",
} as const;
