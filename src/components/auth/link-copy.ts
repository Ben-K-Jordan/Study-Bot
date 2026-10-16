/**
 * Titles and descriptions for the screens an emailed link opens. Shared by
 * the pages (their tab titles, set on the server) and the client cards
 * (their h1), so the tab and the heading always say the same thing. No
 * "use client" here: a Server Component can't read values from a client
 * module.
 */

type ScreenCopy = { title: string; description: string }

/** Why a password reset link didn't work. */
export type ResetLinkProblem = "expired" | "used" | "invalid"

export const RESET_PASSWORD_TITLE = "Choose a new password"

export const RESET_LINK_PROBLEMS: Record<ResetLinkProblem, ScreenCopy> = {
  expired: {
    title: "Reset link expired",
    description: "Reset links last 1 hour. Request a new link to choose a new password.",
  },
  used: {
    title: "Reset link already used",
    description:
      "Each reset link works once, and a newer link replaces older ones. Request a new link if you still need to choose a new password.",
  },
  invalid: {
    title: "This reset link doesn't work",
    description: "The link may be incomplete. Copy the whole link from the email, or request a new one.",
  },
}

/** The reset page's title: the link problem when there is one. */
export function resetPasswordTitle(problem: ResetLinkProblem | null): string {
  return problem ? RESET_LINK_PROBLEMS[problem].title : RESET_PASSWORD_TITLE
}

/**
 * Where the verify-email page is coming from: "sent" after creating an
 * account, or a verification link that didn't work.
 */
export type VerifyEmailStatus = "sent" | "expired" | "invalid" | "busy" | "failed"

export const VERIFY_EMAIL_TITLE = "Verify your email"

export const VERIFY_LINK_PROBLEMS: Record<Exclude<VerifyEmailStatus, "sent">, ScreenCopy> = {
  expired: {
    title: "Verification link expired",
    description: "Verification links last 24 hours. Send a new one to finish creating your account.",
  },
  invalid: {
    title: "This verification link doesn't work",
    description:
      "It may be incomplete, or a newer link replaced it. Send a new one to finish creating your account.",
  },
  busy: {
    title: "Too many attempts",
    description: "Wait a few minutes, then open the link in your email again.",
  },
  failed: {
    title: "Email not verified yet",
    description: "The link couldn't be checked just now. Open it again in a few minutes.",
  },
}

/** A ?status= value from the URL, or "sent" for anything unknown. */
export function parseVerifyEmailStatus(raw: string | undefined): VerifyEmailStatus {
  return raw && Object.hasOwn(VERIFY_LINK_PROBLEMS, raw) ? (raw as VerifyEmailStatus) : "sent"
}

export function verifyEmailTitle(status: VerifyEmailStatus): string {
  return status === "sent" ? VERIFY_EMAIL_TITLE : VERIFY_LINK_PROBLEMS[status].title
}
