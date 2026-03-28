import { customAlphabet } from "nanoid";

/**
 * Generates a crypto-secure, URL-safe session ID.
 * 21 chars from a 64-char alphabet ≈ 126 bits of entropy.
 */
const alphabet =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
const generate = customAlphabet(alphabet, 21);

export function generateSessionId(): string {
  return generate();
}
