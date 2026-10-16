/**
 * Token Vault — AES-256-GCM encryption/decryption for OAuth tokens.
 *
 * Security requirements:
 *   - Tokens encrypted at rest (AES-256-GCM with random IV + auth tag).
 *   - TOKEN_ENC_KEY is required (npm run setup generates one).
 *   - NEVER log plaintext tokens. The logger also redacts token-shaped
 *     strings (./redact) in case one slips through.
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
  const raw = process.env.TOKEN_ENC_KEY;

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOKEN_ENC_KEY env var is required in production");
    }
    throw new Error("TOKEN_ENC_KEY env var is not set");
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
