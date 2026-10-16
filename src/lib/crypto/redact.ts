/**
 * Secret redaction for log lines. The logger (src/lib/logger.ts) runs every
 * string it writes through sanitizeForLog, so a token caught in an error
 * message, such as a failed Google Calendar or AI provider call, never
 * reaches the log in full. Best effort: it covers the formats this app
 * handles. No Node imports, so any module can use it.
 */

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Google OAuth access tokens
  [/ya29\.[A-Za-z0-9_-]+/g, "ya29.[REDACTED]"],
  // Google OAuth refresh tokens
  [/1\/\/[A-Za-z0-9_-]+/g, "1//[REDACTED]"],
  // Authorization header values
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  // OAuth fields in query strings, form bodies and JSON
  [/\b(access_token|refresh_token|id_token|client_secret)("?\s*[:=]\s*"?)[^\s"&,}]+/gi, "$1$2[REDACTED]"],
  // JWTs, such as a session cookie or an ID token
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[JWT_REDACTED]"],
];

// A long base64 run, the shape of an encryptToken blob. Random base64 always
// mixes upper and lower case; URL paths, ids and hex digests are one case,
// so requiring both keeps them readable.
const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/g;

function isMixedCase(text: string): boolean {
  return /[a-z]/.test(text) && /[A-Z]/.test(text);
}

/** Redact anything in `input` that looks like a token or an encrypted token. */
export function sanitizeForLog(input: string): string {
  let sanitized = input;
  for (const [pattern, replacement] of PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.replace(BASE64_RUN, (run) => (isMixedCase(run) ? "[ENCRYPTED_REDACTED]" : run));
}
