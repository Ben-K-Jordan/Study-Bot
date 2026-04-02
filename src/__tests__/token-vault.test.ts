/**
 * Unit tests for token-vault module.
 *
 * Tests:
 * - encrypt→decrypt roundtrip
 * - tampered authTag fails
 * - missing key behavior in production throws
 * - isTokenEncryptedFormat detection
 * - sanitizeForLog redaction
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token-vault", () => {
  let encryptToken: (plain: string) => string;
  let decryptToken: (enc: string) => string;
  let isTokenEncryptedFormat: (s: string) => boolean;
  let sanitizeForLog: (input: string) => string;

  const origEnv = { ...process.env };

  beforeAll(async () => {
    process.env.TOKEN_ENC_KEY = TEST_KEY_HEX;
    const mod = await import("@/lib/crypto/token-vault");
    encryptToken = mod.encryptToken;
    decryptToken = mod.decryptToken;
    isTokenEncryptedFormat = mod.isTokenEncryptedFormat;
    sanitizeForLog = mod.sanitizeForLog;
  });

  afterAll(() => {
    Object.assign(process.env, origEnv);
  });

  describe("encrypt/decrypt roundtrip", () => {
    it("roundtrips a simple string", () => {
      const plain = "ya29.access-token-example";
      const enc = encryptToken(plain);
      expect(enc).not.toBe(plain);
      expect(decryptToken(enc)).toBe(plain);
    });

    it("produces unique ciphertext each time (random IV)", () => {
      const plain = "same-input";
      const a = encryptToken(plain);
      const b = encryptToken(plain);
      expect(a).not.toBe(b);
      expect(decryptToken(a)).toBe(plain);
      expect(decryptToken(b)).toBe(plain);
    });

    it("handles empty string", () => {
      expect(decryptToken(encryptToken(""))).toBe("");
    });

    it("handles unicode and emoji", () => {
      const plain = "token-日本語-emoji-🎉";
      expect(decryptToken(encryptToken(plain))).toBe(plain);
    });
  });

  describe("tamper detection", () => {
    it("throws on tampered ciphertext", () => {
      const enc = encryptToken("secret-token");
      const buf = Buffer.from(enc, "base64");
      buf[buf.length - 1] ^= 0xff;
      const tampered = buf.toString("base64");
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("throws on truncated ciphertext", () => {
      const enc = encryptToken("test");
      const truncated = enc.slice(0, 10);
      expect(() => decryptToken(truncated)).toThrow();
    });
  });

  describe("missing key behavior", () => {
    it("fails without TOKEN_ENC_KEY in production", async () => {
      const savedEnv = { ...process.env };
      delete process.env.TOKEN_ENC_KEY;
      delete process.env.GOOGLE_TOKEN_ENC_KEY;
      delete process.env.TEST_TOKEN_ENC_KEY;
      process.env.NODE_ENV = "production";

      vi.resetModules();
      try {
        const { encryptToken: enc } = await import("@/lib/crypto/token-vault");
        expect(() => enc("test")).toThrow("TOKEN_ENC_KEY");
      } finally {
        Object.assign(process.env, savedEnv);
        vi.resetModules();
      }
    });

    it("accepts TEST_TOKEN_ENC_KEY in non-production", async () => {
      const savedEnv = { ...process.env };
      delete process.env.TOKEN_ENC_KEY;
      delete process.env.GOOGLE_TOKEN_ENC_KEY;
      process.env.TEST_TOKEN_ENC_KEY = TEST_KEY_HEX;
      process.env.NODE_ENV = "test";

      vi.resetModules();
      try {
        const { encryptToken: enc, decryptToken: dec } = await import("@/lib/crypto/token-vault");
        expect(dec(enc("hello"))).toBe("hello");
      } finally {
        Object.assign(process.env, savedEnv);
        vi.resetModules();
      }
    });
  });

  describe("isTokenEncryptedFormat", () => {
    it("returns true for encrypted tokens", () => {
      const enc = encryptToken("test-token");
      expect(isTokenEncryptedFormat(enc)).toBe(true);
    });

    it("returns false for plain text", () => {
      expect(isTokenEncryptedFormat("ya29.plaintext-token")).toBe(false);
    });

    it("returns false for empty/null", () => {
      expect(isTokenEncryptedFormat("")).toBe(false);
      expect(isTokenEncryptedFormat(null as unknown as string)).toBe(false);
      expect(isTokenEncryptedFormat(undefined as unknown as string)).toBe(false);
    });

    it("returns false for short base64", () => {
      expect(isTokenEncryptedFormat("aGVsbG8=")).toBe(false); // "hello" in base64
    });
  });

  describe("sanitizeForLog", () => {
    it("redacts OAuth access tokens", () => {
      const input = 'token: ya29.A0AfH6SMBx_long_access_token_here';
      const result = sanitizeForLog(input);
      expect(result).not.toContain("A0AfH6SMBx");
      expect(result).toContain("ya29.[REDACTED]");
    });

    it("redacts refresh tokens", () => {
      const input = 'refresh: 1//0eXyz_long_refresh_token';
      const result = sanitizeForLog(input);
      expect(result).not.toContain("0eXyz");
      expect(result).toContain("1//[REDACTED]");
    });

    it("redacts long base64 strings", () => {
      const enc = encryptToken("secret");
      const input = `encrypted token: ${enc}`;
      const result = sanitizeForLog(input);
      expect(result).not.toContain(enc);
      expect(result).toContain("[ENCRYPTED_REDACTED]");
    });

    it("leaves short safe strings unchanged", () => {
      const input = "user_id=abc123";
      expect(sanitizeForLog(input)).toBe(input);
    });
  });
});
