/**
 * Settings write failures: which sentence the student sees, and where a
 * failed account deletion is reported (beside the password or below it).
 */
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/client-api";
import { deleteAccountFailure, failureMessage } from "@/components/settings/request";

describe("failureMessage", () => {
  it("says the sign-in expired on a 401", () => {
    expect(failureMessage(new ApiError("x", 401), "Not saved.")).toBe("Your sign-in expired. Sign in again.");
  });

  it("says how long to wait on a 429", () => {
    const error = new ApiError("x", 429, { retry_after_seconds: 1 });
    expect(failureMessage(error, "Not saved.")).toBe("Too many requests. Retry in 1 second.");
  });

  it("falls back to the caller's sentence otherwise", () => {
    expect(failureMessage(new TypeError("Failed to fetch"), "Not saved.")).toBe("Not saved.");
  });
});

describe("deleteAccountFailure", () => {
  it("puts a wrong password beside the password field", () => {
    const message = "That password doesn't match your account. Check it and retry.";
    const error = new ApiError(message, 403, { error: message, code: "WRONG_PASSWORD" });
    expect(deleteAccountFailure(error)).toEqual({ field: message, general: null });
  });

  it("reports anything else as a general failure with a fix", () => {
    expect(deleteAccountFailure(new TypeError("Failed to fetch"))).toEqual({
      field: null,
      general: "Account not deleted. Check your connection and retry.",
    });
    expect(deleteAccountFailure(new ApiError("Forbidden", 403))).toEqual({
      field: null,
      general: "Account not deleted. Check your connection and retry.",
    });
  });

  it("keeps the shared wording for an expired sign-in and rate limits", () => {
    expect(deleteAccountFailure(new ApiError("x", 401)).general).toBe("Your sign-in expired. Sign in again.");
    expect(deleteAccountFailure(new ApiError("x", 429, { retry_after_seconds: 30 })).general).toBe(
      "Too many requests. Retry in 30 seconds.",
    );
  });
});
