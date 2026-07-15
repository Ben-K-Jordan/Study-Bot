import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { consumeToken } from "@/lib/tokens";
import { authLimiter, getClientIp, tooManyRequests } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

const schema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

/**
 * POST /api/auth/reset-password
 * Resets the user's password using a valid reset token.
 */
export async function POST(request: NextRequest) {
  const rl = authLimiter.check(getClientIp(request));
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const userId = await consumeToken(body.token, "PASSWORD_RESET");
  if (!userId) {
    return NextResponse.json(
      { error: "Invalid or expired reset link. Please request a new one." },
      { status: 400 },
    );
  }

  const passwordHash = await bcrypt.hash(body.password, 12);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  logger.info("password_reset.completed", { userId });

  return NextResponse.json({ message: "Password reset successfully. You can now sign in." });
}
