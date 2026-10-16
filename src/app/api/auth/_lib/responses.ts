import { NextResponse } from "next/server";
import { z } from "zod";

import {
  FIELD_MESSAGES,
  NAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordTooLong,
} from "@/lib/auth-validation";
import { EMAIL_NOT_CONFIGURED, tooManyRequestsText } from "@/lib/auth-messages";
import { tooManyRequests } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

/**
 * Shared request schemas and error responses for the auth API routes.
 * Field messages are the ones the forms show, so a rule reads the same
 * whether the browser or the server catches it.
 */

export const emailField = z
  .string({ error: FIELD_MESSAGES.emailMissing })
  .trim()
  .min(1, FIELD_MESSAGES.emailMissing)
  .pipe(z.email({ error: FIELD_MESSAGES.emailInvalid }));

/**
 * A password being set (sign-up, reset). Past 72 bytes bcrypt ignores the
 * rest, so a longer one is refused rather than silently cut. Sign-in keeps
 * accepting any password, so an existing one always still works.
 */
export const newPasswordField = z
  .string({ error: FIELD_MESSAGES.newPasswordMissing })
  .min(1, FIELD_MESSAGES.newPasswordMissing)
  .min(PASSWORD_MIN_LENGTH, FIELD_MESSAGES.passwordShort)
  .refine((password) => !passwordTooLong(password), FIELD_MESSAGES.passwordLong);

export const nameField = z
  .string({ error: FIELD_MESSAGES.nameMissing })
  .trim()
  .min(1, FIELD_MESSAGES.nameMissing)
  .max(NAME_MAX_LENGTH, FIELD_MESSAGES.nameLong);

export interface FieldIssue {
  field: string;
  message: string;
}

/** One issue per field, in schema order. */
export function fieldIssues(error: z.ZodError): FieldIssue[] {
  const seen = new Set<string>();
  const issues: FieldIssue[] = [];
  for (const issue of error.issues) {
    const head = issue.path[0];
    const field = typeof head === "string" ? head : "form";
    if (seen.has(field)) continue;
    seen.add(field);
    issues.push({ field, message: issue.message });
  }
  return issues;
}

/** 400 with `issues` the form maps onto its fields; `error` repeats the first one. */
export function invalidFields(error: z.ZodError): NextResponse {
  const issues = fieldIssues(error);
  return NextResponse.json(
    { error: issues[0]?.message ?? "Check the highlighted fields.", code: "INVALID_FIELDS", issues },
    { status: 400 },
  );
}

export function unreadableBody(): NextResponse {
  return NextResponse.json(
    { error: "This request couldn't be read. Reload the page and retry.", code: "INVALID_BODY" },
    { status: 400 },
  );
}

/** Parse a JSON body, or null when it isn't JSON. */
export async function readJson(request: Request): Promise<unknown | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

/**
 * A 503 for a link that can't be emailed (see areEmailLinksAvailable). The same
 * answer for every address, so it says nothing about which accounts exist.
 */
export function emailNotConfigured(message: string): NextResponse {
  return NextResponse.json({ error: message, code: EMAIL_NOT_CONFIGURED }, { status: 503 });
}

/** A 429 whose message names the limited action and when to retry. */
export function rateLimited(retryAfterMs: number, subject: string): NextResponse {
  return tooManyRequests(retryAfterMs, tooManyRequestsText(subject, Math.ceil(retryAfterMs / 1000)));
}

/**
 * Developer hint for local runs with verification switched on: the console
 * email provider prints the link in the server terminal. This goes to the
 * log only, never to the page.
 */
export function logVerificationLinkHint(): void {
  if (process.env.NODE_ENV === "production") return;
  if (process.env.REQUIRE_EMAIL_VERIFICATION !== "true") return;
  if ((process.env.EMAIL_PROVIDER || "console") !== "console") return;
  logger.info("auth.verification_link_in_console", {
    hint:
      "REQUIRE_EMAIL_VERIFICATION is on and EMAIL_PROVIDER is console, so the verification link is printed in this terminal. Open it to verify the account.",
  });
}
