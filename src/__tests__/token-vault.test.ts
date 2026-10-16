/**
 * Unit tests for token-vault module.
 *
 * Tests:
 * - encrypt→decrypt roundtrip
 * - tampered authTag fails
 * - missing key behavior in production throws
 *
 * Log redaction (sanitizeForLog) is in log-redaction.test.ts.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token-vault", () => {
  let encryptToken: (plain: string) => string;
  let decryptToken: (enc: string) => string;

  const origEnv = { ...process.env };

  beforeAll(async () => {
    process.env.TOKEN_ENC_KEY = TEST_KEY_HEX;
    const mod = await import("@/lib/crypto/token-vault");
    encryptToken = mod.encryptToken;
    decryptToken = mod.decryptToken;
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
      (process.env as Record<string, string>).NODE_ENV = "production";

      vi.resetModules();
      try {
        const { encryptToken: enc } = await import("@/lib/crypto/token-vault");
        expect(() => enc("test")).toThrow("TOKEN_ENC_KEY");
      } finally {
        Object.assign(process.env, savedEnv);
        vi.resetModules();
      }
    });
  });
});
