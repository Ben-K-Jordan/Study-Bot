import { randomBytes } from "crypto";
import { prisma } from "@/lib/db";

const TOKEN_BYTES = 32;
const EMAIL_VERIFY_EXPIRY_HOURS = 24;
const PASSWORD_RESET_EXPIRY_HOURS = 1;

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

/** Verify and consume a token. Returns the userId if valid, null otherwise. */
export async function consumeToken(
  token: string,
  expectedType: "EMAIL_VERIFY" | "PASSWORD_RESET",
): Promise<string | null> {
  const record = await prisma.verificationToken.findUnique({ where: { token } });

  if (!record) return null;
  if (record.type !== expectedType) return null;
  if (record.usedAt) return null; // already used
  if (record.expiresAt < new Date()) return null; // expired

  // Mark as used
  await prisma.verificationToken.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });

  return record.userId;
}
