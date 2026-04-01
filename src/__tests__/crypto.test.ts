/**
 * Unit tests for AES-256-GCM encryption roundtrip.
 */
import { describe, it, expect, beforeAll } from "vitest";

// Set a deterministic test key before importing
const TEST_KEY_HEX = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("crypto encrypt/decrypt", () => {
  let encrypt: (plaintext: string) => string;
  let decrypt: (encoded: string) => string;

  beforeAll(async () => {
    process.env.GOOGLE_TOKEN_ENC_KEY = TEST_KEY_HEX;
    const mod = await import("@/lib/crypto");
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  it("roundtrips a simple string", () => {
    const plaintext = "ya29.access-token-here";
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toEqual(plaintext);
    expect(decrypt(encrypted)).toEqual(plaintext);
  });

  it("produces different ciphertext for same plaintext (unique IV)", () => {
    const plaintext = "same-input";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a).not.toEqual(b);
    // Both decrypt to same value
    expect(decrypt(a)).toEqual(plaintext);
    expect(decrypt(b)).toEqual(plaintext);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toEqual("");
  });

  it("handles unicode", () => {
    const plaintext = "token-日本語-emoji-🎉";
    expect(decrypt(encrypt(plaintext))).toEqual(plaintext);
  });

  it("throws on tampered ciphertext", () => {
    const encrypted = encrypt("secret");
    // Tamper with the encoded string
    const buf = Buffer.from(encrypted, "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = buf.toString("base64");
    expect(() => decrypt(tampered)).toThrow();
  });
});
