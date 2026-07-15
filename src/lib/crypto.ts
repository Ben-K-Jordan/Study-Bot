/**
 * AES-256-GCM encryption helpers for storing OAuth tokens.
 *
 * This module re-exports from the canonical token-vault module for
 * backward compatibility. New code should import from @/lib/crypto/token-vault.
 */
export {
  encryptToken as encrypt,
  decryptToken as decrypt,
  isTokenEncryptedFormat,
  sanitizeForLog,
} from "./crypto/token-vault";
