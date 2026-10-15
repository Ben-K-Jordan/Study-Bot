import { describe, it, expect } from "vitest";
import {
  parseRetryAfter,
  retryAfterText,
  signInErrorBanner,
  signInFailureFromCode,
  signInFailureMessage,
  SIGN_IN_MESSAGES,
  REQUEST_FAILED,
} from "@/components/auth/messages";
import {
  FIELD_MESSAGES,
  collectErrors,
  hasErrors,
  validateCurrentPassword,
  validateEmail,
  validateName,
  validateNewPassword,
  validatePasswordConfirmation,
} from "@/components/auth/validation";

describe("retryAfterText", () => {
  it("uses whole seconds under a minute and whole minutes after", () => {
    expect(retryAfterText(1)).toBe("Retry in 1 second.");
    expect(retryAfterText(30)).toBe("Retry in 30 seconds.");
    expect(retryAfterText(59.2)).toBe("Retry in 1 minute.");
    expect(retryAfterText(60)).toBe("Retry in 1 minute.");
    expect(retryAfterText(61)).toBe("Retry in 2 minutes.");
    expect(retryAfterText(720)).toBe("Retry in 12 minutes.");
  });

  it("has a fallback when the wait is unknown", () => {
    expect(retryAfterText(null)).toBe("Retry in a few minutes.");
    expect(retryAfterText(undefined)).toBe("Retry in a few minutes.");
    expect(retryAfterText(0)).toBe("Retry in a few minutes.");
    expect(retryAfterText(Number.NaN)).toBe("Retry in a few minutes.");
  });
});

describe("parseRetryAfter", () => {
  it("reads delta-seconds and HTTP dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter(" 5 ")).toBe(5);
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(parseRetryAfter("Thu, 15 Oct 2026 12:01:30 GMT", now)).toBe(90);
    expect(parseRetryAfter("Thu, 15 Oct 2026 11:00:00 GMT", now)).toBe(0);
  });

  it("returns null for missing or unreadable values", () => {
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("")).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
  });
});

describe("sign-in messages", () => {
  it("maps next-auth codes without ever showing the code", () => {
    expect(signInFailureFromCode("CredentialsSignin")).toEqual({ status: "invalid" });
    expect(signInFailureFromCode("EmailNotVerified")).toEqual({ status: "unverified" });
    expect(signInFailureFromCode("Configuration")).toEqual({ status: "unavailable" });
    expect(signInErrorBanner("Configuration")).toBe(SIGN_IN_MESSAGES.notAvailable);
    expect(signInErrorBanner("<script>alert(1)</script>")).toBe(SIGN_IN_MESSAGES.notAvailable);
    expect(signInErrorBanner("CredentialsSignin")).toBe(SIGN_IN_MESSAGES.invalid);
    expect(signInErrorBanner("SessionRequired")).toBeNull();
    expect(signInErrorBanner(undefined)).toBeNull();
  });

  it("words a rate limit with the wait", () => {
    expect(signInFailureMessage({ status: "rate-limited", retryAfterSeconds: 720 })).toBe(
      "Too many sign-in attempts. Retry in 12 minutes.",
    );
    expect(signInFailureMessage({ status: "unavailable" })).toBe(SIGN_IN_MESSAGES.unavailable);
  });

  it("follows the voice rules: full sentences, no dashes, exclamation marks or 'please'", () => {
    const all = [
      ...Object.values(SIGN_IN_MESSAGES),
      ...Object.values(FIELD_MESSAGES),
      ...Object.values(REQUEST_FAILED),
    ];
    for (const text of all) {
      expect(text).not.toMatch(/[—–!]|please|oops|successfully|something went wrong/i);
      expect(text.endsWith(".")).toBe(true);
    }
  });
});

describe("field validation", () => {
  it("checks email presence and shape", () => {
    expect(validateEmail("")).toBe(FIELD_MESSAGES.emailMissing);
    expect(validateEmail("   ")).toBe(FIELD_MESSAGES.emailMissing);
    expect(validateEmail("a@b")).toBe(FIELD_MESSAGES.emailInvalid);
    expect(validateEmail("name@example")).toBe(FIELD_MESSAGES.emailInvalid);
    expect(validateEmail(" name@example.com ")).toBeNull();
  });

  it("only requires a password on sign-in, and 8 characters for a new one", () => {
    expect(validateCurrentPassword("")).toBe(FIELD_MESSAGES.passwordMissing);
    expect(validateCurrentPassword("short")).toBeNull();
    expect(validateNewPassword("")).toBe(FIELD_MESSAGES.newPasswordMissing);
    expect(validateNewPassword("1234567")).toBe(FIELD_MESSAGES.passwordShort);
    expect(validateNewPassword("12345678")).toBeNull();
  });

  it("checks the confirmation and the name", () => {
    expect(validatePasswordConfirmation("abcdefgh", "")).toBe(FIELD_MESSAGES.confirmMissing);
    expect(validatePasswordConfirmation("abcdefgh", "abcdefgx")).toBe(FIELD_MESSAGES.passwordMismatch);
    expect(validatePasswordConfirmation("abcdefgh", "abcdefgh")).toBeNull();
    expect(validateName(" ")).toBe(FIELD_MESSAGES.nameMissing);
    expect(validateName("x".repeat(51))).toBe(FIELD_MESSAGES.nameLong);
    expect(validateName("Ben")).toBeNull();
  });

  it("collects only the failed checks", () => {
    const errors = collectErrors({ email: null, password: "Enter your password." });
    expect(errors).toEqual({ password: "Enter your password." });
    expect(hasErrors(errors)).toBe(true);
    expect(hasErrors(collectErrors({ email: null }))).toBe(false);
  });
});
