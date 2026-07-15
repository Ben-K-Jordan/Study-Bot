/**
 * Token Vault — AES-256-GCM encryption/decryption for OAuth tokens.
 *
 * Security requirements:
 *   - Tokens encrypted at rest (AES-256-GCM with random IV + auth tag).
 *   - TOKEN_ENC_KEY required in production.
 *   - In dev/test: TOKEN_ENC_KEY or TEST_TOKEN_ENC_KEY accepted.
 *   - NEVER log plaintext tokens.
 *   - Format: base64(iv + authTag + ciphertext) — compatible with existing stored tokens.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const IV_LEN = 12;
const TAG_LEN = 16;
const ALGO = "aes-256-gcm";

/**
 * Resolve the 32-byte encryption key from environment.
 * Accepts 64-char hex or 44-char base64 encoding.
 */
function getKey(): Buffer {
  const raw =
    process.env.TOKEN_ENC_KEY ||
    process.env.GOOGLE_TOKEN_ENC_KEY ||
    (process.env.NODE_ENV !== "production" ? process.env.TEST_TOKEN_ENC_KEY : undefined);

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENC_KEY env var is required in production");
    }
    throw new Error(
      "TOKEN_ENC_KEY (or GOOGLE_TOKEN_ENC_KEY / TEST_TOKEN_ENC_KEY) env var is not set",
    );
  }

  // Accept hex (64 chars) or base64 (44 chars)
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  const buf = Buffer.from(raw, "base64");
  if (buf.length === 32) return buf;
  throw new Error("TOKEN_ENC_KEY must be 32 bytes (64 hex chars or 44 base64 chars)");
}

/**
 * Encrypt a plaintext token string.
 * Returns: base64(iv + authTag + ciphertext)
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Pack: iv + tag + ciphertext → base64
  const packed = Buffer.concat([iv, tag, encrypted]);
  return packed.toString("base64");
}

/**
 * Decrypt an encrypted token string.
 * Input: base64(iv + authTag + ciphertext)
 */
export function decryptToken(encoded: string): string {
  const key = getKey();
  const packed = Buffer.from(encoded, "base64");
  if (packed.length < IV_LEN + TAG_LEN) {
    throw new Error("Invalid encrypted token data (too short)");
  }
  const iv = packed.subarray(0, IV_LEN);
  const tag = packed.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = packed.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Check if a string looks like it was produced by encryptToken.
 * Validates base64 format and minimum length (iv + tag = 28 bytes).
 */
export function isTokenEncryptedFormat(s: string): boolean {
  if (!s || typeof s !== "string") return false;
  // Must be valid base64 and decode to at least iv + tag length
  try {
    const buf = Buffer.from(s, "base64");
    // Verify re-encoding matches (not arbitrary string)
    if (buf.toString("base64") !== s) return false;
    return buf.length >= IV_LEN + TAG_LEN;
  } catch {
    return false;
  }
}

/**
 * Log sanitizer: redact anything that looks like a token or encrypted token.
 * Best-effort — catches common patterns:
 *   - OAuth access tokens (ya29.*)
 *   - Refresh tokens (1//*)
 *   - Base64 strings > 40 chars (likely encrypted tokens)
 */
export function sanitizeForLog(input: string): string {
  // OAuth access tokens
  let sanitized = input.replace(/ya29\.[A-Za-z0-9_-]+/g, "ya29.[REDACTED]");
  // Refresh tokens
  sanitized = sanitized.replace(/1\/\/[A-Za-z0-9_-]+/g, "1//[REDACTED]");
  // Long base64 strings (likely encrypted blobs)
  sanitized = sanitized.replace(/[A-Za-z0-9+/]{40,}={0,2}/g, "[ENCRYPTED_REDACTED]");
  return sanitized;
}
