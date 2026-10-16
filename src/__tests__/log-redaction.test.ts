/**
 * Token redaction in logs: sanitizeForLog's patterns, and the logger running
 * every string it writes through it.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { sanitizeForLog } from "@/lib/crypto/redact";
import { logger } from "@/lib/logger";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("sanitizeForLog", () => {
  let encryptToken: (plain: string) => string;

  beforeAll(async () => {
    vi.stubEnv("TOKEN_ENC_KEY", TEST_KEY_HEX);
    encryptToken = (await import("@/lib/crypto/token-vault")).encryptToken;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("redacts OAuth access tokens", () => {
    const result = sanitizeForLog("token: ya29.A0AfH6SMBx_long_access_token_here");
    expect(result).not.toContain("A0AfH6SMBx");
    expect(result).toContain("ya29.[REDACTED]");
  });

  it("redacts refresh tokens", () => {
    const result = sanitizeForLog("refresh: 1//0eXyz_long_refresh_token");
    expect(result).not.toContain("0eXyz");
    expect(result).toContain("1//[REDACTED]");
  });

  it("redacts encrypted tokens", () => {
    for (const plain of ["secret", "ya29.a-much-longer-access-token-value-0123456789"]) {
      const enc = encryptToken(plain);
      const result = sanitizeForLog(`encrypted token: ${enc}`);
      expect(result).not.toContain(enc);
      expect(result).toContain("[ENCRYPTED_REDACTED]");
    }
  });

  it("redacts bearer headers, OAuth fields and JWTs", () => {
    expect(sanitizeForLog("Authorization: Bearer abc.DEF-123_xyz")).toBe("Authorization: Bearer [REDACTED]");
    expect(sanitizeForLog("POST /token?client_secret=s3cr3t&grant_type=refresh_token")).toBe(
      "POST /token?client_secret=[REDACTED]&grant_type=refresh_token",
    );
    expect(sanitizeForLog('{"access_token": "opaque-value", "expires_in": 3599}')).toBe(
      '{"access_token": "[REDACTED]", "expires_in": 3599}',
    );
    expect(sanitizeForLog("cookie eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2lnbmF0dXJl end")).toBe(
      "cookie [JWT_REDACTED] end",
    );
  });

  it("keeps ids, paths, URLs and digests readable", () => {
    for (const safe of [
      "user_id=abc123",
      "/api/plans/cmg5x2abc0001qwertyzxcv1234/items/cmg5x2abc0002qwertyzxcv5678/status",
      "GET https://www.googleapis.com/calendar/v3/calendars/primary/events failed with 503",
      "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "Missing required parameter: refresh_token",
      "5eed0000-de70-4000-8000-000000000001",
    ]) {
      expect(sanitizeForLog(safe)).toBe(safe);
    }
  });
});

describe("logger", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("redacts tokens in every string it writes, nested ones included", () => {
    vi.stubEnv("LOG_LEVEL", "debug");
    const out = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});

    logger.warn("google.retry", { error: "401 for ya29.leaked-access-token", detail: { body: ["1//leaked-refresh"] } });
    logger.error("google.publish.item", { error: "Bearer leaked.token.value rejected", plan_item_id: "item_1" });

    const lines = [...out.mock.calls, ...err.mock.calls].map((call) => String(call[0]));
    const written = lines.join("\n");
    expect(written).not.toContain("leaked");
    expect(JSON.parse(lines[0])).toMatchObject({
      level: "warn",
      event: "google.retry",
      error: "401 for ya29.[REDACTED]",
      detail: { body: ["1//[REDACTED]"] },
    });
    expect(JSON.parse(lines[1])).toMatchObject({ event: "google.publish.item", plan_item_id: "item_1" });
  });
});
