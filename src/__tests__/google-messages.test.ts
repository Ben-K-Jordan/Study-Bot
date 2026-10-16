/**
 * User-facing Google Calendar copy: OAuth landing results and API codes.
 */
import { describe, it, expect } from "vitest";
import { GOOGLE_COPY, googleConnectResult, googleErrorMessage } from "@/lib/google/messages";

const REASONS = [
  "access_denied",
  "invalid_state",
  "missing_params",
  "not_configured",
  "token_exchange_failed",
  "no_refresh_token",
  "internal",
  "something_new",
];

describe("googleConnectResult", () => {
  it("reports a connection", () => {
    expect(googleConnectResult("connected", null)).toMatchObject({
      tone: "success",
      title: "Google Calendar connected",
    });
  });

  it("returns null when the page wasn't reached from the callback", () => {
    expect(googleConnectResult(undefined, undefined)).toBeNull();
    expect(googleConnectResult("weird", "access_denied")).toBeNull();
  });

  it("gives every failure reason a title and a next step", () => {
    for (const reason of REASONS) {
      const result = googleConnectResult("error", reason);
      expect(result?.tone).toBe("error");
      expect(result?.title).toBe("Google Calendar not connected");
      expect(result?.description).toMatch(/\.$/);
    }
  });

  it("never shows raw codes, dashes or exclamation marks", () => {
    for (const reason of REASONS) {
      for (const dev of [false, true]) {
        const result = googleConnectResult("error", reason, { dev });
        const text = `${result?.title} ${result?.description}`;
        expect(text).not.toContain(reason);
        expect(text).not.toMatch(/[–—!]/);
      }
    }
  });

  it("keeps setup details for development", () => {
    expect(googleConnectResult("error", "not_configured")?.description).not.toContain("GOOGLE_CLIENT_ID");
    expect(googleConnectResult("error", "not_configured", { dev: true })?.description).toContain(
      "GOOGLE_CLIENT_ID",
    );
  });
});

describe("googleErrorMessage", () => {
  it("maps API codes to sentences", () => {
    expect(googleErrorMessage("GOOGLE_RECONNECT_REQUIRED")).toBe(GOOGLE_COPY.reconnect);
    expect(googleErrorMessage("INVALID_GRANT")).toBe(GOOGLE_COPY.reconnect);
    expect(googleErrorMessage("GOOGLE_NOT_CONNECTED")).toBe(GOOGLE_COPY.notConnected);
    expect(googleErrorMessage("ALREADY_PUBLISHED_DIFFERENT_CALENDAR")).toBe(GOOGLE_COPY.differentCalendar);
    expect(googleErrorMessage("not_found")).toBe("This plan doesn't exist anymore.");
    expect(googleErrorMessage("forbidden")).toBe("This plan belongs to another account.");
    expect(googleErrorMessage(undefined)).toBe(GOOGLE_COPY.unavailable);
  });

  it("has one fallback sentence for every other failure", () => {
    expect(GOOGLE_COPY.unavailable).toBe("Google Calendar didn't respond. Retry in a minute.");
    for (const code of ["GOOGLE_API_ERROR", "RATE_LIMITED", "", null]) {
      expect(googleErrorMessage(code)).toBe(GOOGLE_COPY.unavailable);
    }
  });

  it("never shows a raw code, a dash or an exclamation mark", () => {
    for (const text of Object.values(GOOGLE_COPY)) {
      expect(text).not.toMatch(/[A-Z]{2,}_[A-Z_]+|[–—!]/);
    }
  });
});
