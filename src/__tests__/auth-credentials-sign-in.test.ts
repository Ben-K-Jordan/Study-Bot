import { describe, it, expect } from "vitest";
import { interpretSignInResponse } from "@/components/auth/credentials-sign-in";
import { interpretAuthError } from "@/components/auth/auth-request";
import { ApiError } from "@/lib/client-api";

describe("interpretSignInResponse", () => {
  it("treats a callback URL without an error as signed in", () => {
    expect(interpretSignInResponse(200, null, { url: "http://localhost:3000/plan" })).toEqual({ status: "ok" });
  });

  it("maps wrong credentials and an unverified email", () => {
    expect(
      interpretSignInResponse(401, null, {
        url: "http://localhost:3000/api/auth/error?error=CredentialsSignin&provider=credentials",
      }),
    ).toEqual({ status: "invalid" });
    expect(
      interpretSignInResponse(401, null, { url: "http://localhost:3000/api/auth/error?error=EmailNotVerified" }),
    ).toEqual({ status: "unverified" });
  });

  it("reads the rate limit and its Retry-After instead of hanging", () => {
    expect(interpretSignInResponse(429, "720", { error: "Too many requests. Please try again later." })).toEqual({
      status: "rate-limited",
      retryAfterSeconds: 720,
    });
    expect(interpretSignInResponse(429, null, null)).toEqual({ status: "rate-limited", retryAfterSeconds: null });
  });

  it("doesn't mistake a CSRF rejection for a sign-in", () => {
    expect(interpretSignInResponse(200, null, { url: "http://localhost:3000/auth/signin?csrf=true" })).toEqual({
      status: "unavailable",
    });
  });

  it("calls anything else unavailable", () => {
    expect(interpretSignInResponse(500, null, null)).toEqual({ status: "unavailable" });
    expect(interpretSignInResponse(200, null, { error: "x" })).toEqual({ status: "unavailable" });
    expect(interpretSignInResponse(500, null, { url: "http://localhost:3000/" })).toEqual({ status: "unavailable" });
    expect(
      interpretSignInResponse(401, null, { url: "http://localhost:3000/api/auth/error?error=Configuration" }),
    ).toEqual({ status: "unavailable" });
  });
});

describe("interpretAuthError", () => {
  it("maps field issues by field", () => {
    const error = new ApiError("Enter your name.", 400, {
      error: "Enter your name.",
      code: "INVALID_FIELDS",
      issues: [
        { field: "name", message: "Enter your name." },
        { field: "email", message: "Enter an email address like name@example.com." },
      ],
    });
    expect(interpretAuthError(error)).toEqual({
      ok: false,
      kind: "fields",
      issues: { name: "Enter your name.", email: "Enter an email address like name@example.com." },
    });
  });

  it("passes on a 429 the route worded, and rewords the old default", () => {
    expect(interpretAuthError(new ApiError("Too many reset requests. Retry in 3 minutes.", 429))).toEqual({
      ok: false,
      kind: "rate-limited",
      message: "Too many reset requests. Retry in 3 minutes.",
    });
    expect(interpretAuthError(new ApiError("Too many requests. Please try again later.", 429))).toEqual({
      ok: false,
      kind: "rate-limited",
      message: "Too many requests. Retry in a few minutes.",
    });
  });

  it("returns known codes and hides server failures", () => {
    expect(interpretAuthError(new ApiError("x", 400, { error: "x", code: "TOKEN_EXPIRED" }))).toEqual({
      ok: false,
      kind: "code",
      code: "TOKEN_EXPIRED",
    });
    expect(interpretAuthError(new ApiError("x", 400, { code: "INVALID_BODY" }))).toEqual({ ok: false, kind: "failed" });
    expect(interpretAuthError(new ApiError("Failed", 500, { error: "Failed" }))).toEqual({ ok: false, kind: "failed" });
    expect(interpretAuthError(new TypeError("Failed to fetch"))).toEqual({ ok: false, kind: "failed" });
  });

  it("passes on the 503 for a server that can't send email, so the form can say why", () => {
    const error = new ApiError("Reset link not sent.", 503, { error: "Reset link not sent.", code: "EMAIL_NOT_CONFIGURED" });
    expect(interpretAuthError(error)).toEqual({ ok: false, kind: "code", code: "EMAIL_NOT_CONFIGURED" });
    // Any other 5xx code still reads as a failed request.
    expect(interpretAuthError(new ApiError("x", 503, { code: "SOMETHING_ELSE" }))).toEqual({ ok: false, kind: "failed" });
  });
});
