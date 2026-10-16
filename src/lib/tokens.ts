import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const TOKEN_BYTES = 32;
export const EMAIL_VERIFY_EXPIRY_HOURS = 24;
export const PASSWORD_RESET_EXPIRY_HOURS = 1;

export type TokenType = "EMAIL_VERIFY" | "PASSWORD_RESET";

/**
 * What a link's token is good for. `valid` from redeemToken means this call
 * used it up; `used` covers both a link opened twice and one replaced by a
 * newer link (creating a token marks the older ones used).
 */
export type TokenState =
  | { status: "valid"; userId: string }
  | { status: "expired"; userId: string }
  | { status: "used"; userId: string }
  | { status: "invalid" };

interface TokenRecord {
  userId: string;
  type: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** Generate a cryptographically secure URL-safe token */
function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What the database stores for a token: its SHA-256 digest. The raw token
 * exists only in the emailed link, so a database read (a backup, a replica)
 * can't be turned into a working reset link. Exported for tests.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Rows stay a day past expiry, so an old link still reads "expired" for a while. */
const PURGE_AFTER_MS = 24 * 60 * 60 * 1000;
const PURGE_EVERY_MS = 60 * 60 * 1000;
let lastPurgeAt = 0;

/** Delete link tokens that expired more than a day ago. */
export async function purgeExpiredTokens(now: Date = new Date()): Promise<number> {
  const { count } = await prisma.verificationToken.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - PURGE_AFTER_MS) } },
  });
  return count;
}

/**
 * Purge at most once an hour, from the paths that create tokens. Best
 * effort: a failed purge never stops a link from being sent.
 */
async function purgeExpiredTokensOccasionally(): Promise<void> {
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = now;
  try {
    await purgeExpiredTokens(new Date(now));
  } catch (err) {
    logger.warn("tokens.purge_failed", { error: String(err) });
  }
}

/** Start a new link token for a user, ending any unused one of the same type. */
async function createToken(userId: string, type: TokenType, expiryHours: number): Promise<string> {
  await purgeExpiredTokensOccasionally();

  // Invalidate any existing unused token of this type
  await prisma.verificationToken.updateMany({
    where: { userId, type, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: { userId, token: hashToken(token), type, expiresAt },
  });

  return token;
}

/** Create an email verification token for a user. Returns the raw token for the link. */
export function createEmailVerificationToken(userId: string): Promise<string> {
  return createToken(userId, "EMAIL_VERIFY", EMAIL_VERIFY_EXPIRY_HOURS);
}

/** Create a password reset token for a user. Returns the raw token for the link. */
export function createPasswordResetToken(userId: string): Promise<string> {
  return createToken(userId, "PASSWORD_RESET", PASSWORD_RESET_EXPIRY_HOURS);
}

/** Classify a stored token without changing it. Exported for tests. */
export function classifyToken(
  record: TokenRecord | null,
  expectedType: TokenType,
  now: Date,
): TokenState {
  if (!record || record.type !== expectedType) return { status: "invalid" };
  if (record.usedAt) return { status: "used", userId: record.userId };
  if (record.expiresAt <= now) return { status: "expired", userId: record.userId };
  return { status: "valid", userId: record.userId };
}

/**
 * Read a token's state without using it, so a page can show "this link
 * expired" before the student fills in a form.
 */
export async function inspectToken(token: string, expectedType: TokenType): Promise<TokenState> {
  if (!token) return { status: "invalid" };
  const record = await prisma.verificationToken.findUnique({ where: { token: hashToken(token) } });
  return classifyToken(record, expectedType, new Date());
}

/**
 * Use a token once. The conditional update is the claim, so two requests
 * racing on the same link can't both succeed; anything else reports why the
 * link didn't work.
 */
export async function redeemToken(token: string, expectedType: TokenType): Promise<TokenState> {
  if (!token) return { status: "invalid" };
  const now = new Date();
  const stored = hashToken(token);

  const { count } = await prisma.verificationToken.updateMany({
    where: { token: stored, type: expectedType, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  const record = await prisma.verificationToken.findUnique({ where: { token: stored } });

  if (count === 1 && record) return { status: "valid", userId: record.userId };
  const state = classifyToken(record, expectedType, now);
  // Unclaimed but "valid" can only mean the row changed between the two
  // queries; treat it as already used rather than letting it through.
  return state.status === "valid" ? { status: "used", userId: state.userId } : state;
}

/**
 * Verify and consume a token. Returns the userId if this call used it,
 * null otherwise. Kept for callers that don't need the reason.
 */
export async function consumeToken(token: string, expectedType: TokenType): Promise<string | null> {
  const state = await redeemToken(token, expectedType);
  return state.status === "valid" ? state.userId : null;
}
