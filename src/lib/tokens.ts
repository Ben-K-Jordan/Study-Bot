import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";

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

/** Create an email verification token for a user */
export async function createEmailVerificationToken(userId: string): Promise<string> {
  // Invalidate any existing unused email verification tokens
  await prisma.verificationToken.updateMany({
    where: { userId, type: "EMAIL_VERIFY", usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + EMAIL_VERIFY_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: { userId, token, type: "EMAIL_VERIFY", expiresAt },
  });

  return token;
}

/** Create a password reset token for a user */
export async function createPasswordResetToken(userId: string): Promise<string> {
  // Invalidate any existing unused password reset tokens
  await prisma.verificationToken.updateMany({
    where: { userId, type: "PASSWORD_RESET", usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_EXPIRY_HOURS * 60 * 60 * 1000);

  await prisma.verificationToken.create({
    data: { userId, token, type: "PASSWORD_RESET", expiresAt },
  });

  return token;
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
  const record = await prisma.verificationToken.findUnique({ where: { token } });
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

  const { count } = await prisma.verificationToken.updateMany({
    where: { token, type: expectedType, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  const record = await prisma.verificationToken.findUnique({ where: { token } });

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
