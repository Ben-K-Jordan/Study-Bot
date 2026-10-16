import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { DELETE_ACCOUNT_PHRASE } from "@/lib/account";
import { getUserId } from "@/lib/auth";
import { forgetSessionCheck } from "@/lib/auth-options";
import { decryptToken } from "@/lib/crypto/token-vault";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { tooManyRequests } from "@/lib/rate-limit";
import { accountDeleteLimiter, deleteUserFiles } from "@/services/account";

const deleteSchema = z.object({
  confirm: z.literal(DELETE_ACCOUNT_PHRASE),
  password: z.string().min(1).max(200),
});

const SIGNED_OUT = "Your sign-in expired. Sign in again.";
const NOT_DELETED = "Account not deleted. Confirm in the dialog and retry.";
const WRONG_PASSWORD = "That password doesn't match your account. Check it and retry.";

/**
 * Best effort: revoke Study Bot's Google access before the tokens are
 * deleted, so the account doesn't keep a live grant at Google.
 */
async function revokeGoogleAccess(userId: string): Promise<void> {
  try {
    const integration = await prisma.googleIntegration.findUnique({
      where: { userId },
      select: { accessTokenEncrypted: true, refreshTokenEncrypted: true },
    });
    const encrypted = integration?.refreshTokenEncrypted ?? integration?.accessTokenEncrypted;
    if (!encrypted) return;
    const token = decryptToken(encrypted);
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    // Ignore: the tokens are deleted below either way.
  }
}

/**
 * DELETE /api/account/delete with body { confirm: "DELETE MY ACCOUNT", password }.
 * Permanently deletes the student and everything they own, uploaded files
 * included. The password is checked first, so a session alone (a borrowed
 * laptop, a stolen cookie) can't wipe the account. The client signs out
 * afterwards, since the session token outlives the account.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: SIGNED_OUT }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: NOT_DELETED }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: NOT_DELETED, issues: parsed.error.issues }, { status: 400 });
  }

  const limit = accountDeleteLimiter.check(userId);
  if (!limit.allowed) {
    return tooManyRequests(limit.retryAfterMs);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user) {
    return NextResponse.json({ error: SIGNED_OUT }, { status: 401 });
  }
  if (!(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return NextResponse.json(
      {
        error: WRONG_PASSWORD,
        code: "WRONG_PASSWORD",
        issues: [{ path: ["password"], message: WRONG_PASSWORD }],
      },
      { status: 403 },
    );
  }

  await revokeGoogleAccess(userId);

  try {
    await prisma.$transaction(async (tx) => {
      // Phase 1: Leaf models with userId (no children, or children cascade)
      await Promise.all([
        tx.cardReview.deleteMany({ where: { userId } }),
        tx.xpEvent.deleteMany({ where: { userId } }),
        tx.achievement.deleteMany({ where: { userId } }),
        tx.objectiveMastery.deleteMany({ where: { userId } }),
        tx.aiCallLog.deleteMany({ where: { userId } }),
        tx.oAuthState.deleteMany({ where: { userId } }),
        tx.studyGuide.deleteMany({ where: { userId } }),
        tx.planItemExternalEvent.deleteMany({ where: { userId } }),
        tx.planCalendarPublication.deleteMany({ where: { userId } }),
        tx.planReflowAudit.deleteMany({ where: { userId } }),
        tx.objectiveAnchor.deleteMany({ where: { userId } }),
        tx.sessionErrorLog.deleteMany({ where: { userId } }),
        tx.chatMessage.deleteMany({ where: { userId } }),
        tx.verificationToken.deleteMany({ where: { userId } }),
        // Queued embedding jobs carry the student's id in their payload. A
        // running job is left to finish; it finds no chunks once they're gone.
        tx.jobQueue.deleteMany({
          where: { payload: { path: ["userId"], equals: userId }, status: { not: "RUNNING" } },
        }),
      ]);

      // Phase 2: Child models without userId (filter via parent relation)
      await Promise.all([
        tx.sessionAttempt.deleteMany({ where: { run: { userId } } }),
        tx.studyPlanItem.deleteMany({ where: { plan: { userId } } }),
      ]);

      // Phase 3: Parent models with userId (their cascading children are gone)
      await Promise.all([
        tx.evidencePaper.deleteMany({ where: { userId } }),
        tx.flashcardDeck.deleteMany({ where: { userId } }),
        tx.sessionRun.deleteMany({ where: { userId } }),
        tx.googleIntegration.deleteMany({ where: { userId } }),
        tx.userGameState.deleteMany({ where: { userId } }),
      ]);

      // Phase 4: Top-level parent models
      await Promise.all([
        tx.session.deleteMany({ where: { userId } }),
        tx.contentDocument.deleteMany({ where: { userId } }),
        tx.studyPlan.deleteMany({ where: { userId } }),
      ]);

      // Phase 5: Delete User — remaining cascade relations handle the rest
      await tx.user.delete({ where: { id: userId } });
    });
  } catch (err) {
    logger.error("account.delete.failed", { userId, error: String(err) });
    return NextResponse.json(
      { error: "Account not deleted. Check your connection and retry." },
      { status: 500 },
    );
  }

  logger.info("account.deleted", { userId });
  // Sessions on other devices end on their next request, not after the
  // recheck interval.
  forgetSessionCheck(userId);

  // The rows are gone; now the uploaded lecture files. Nothing references
  // them any more, so a later cleanup could never find them. A failure here
  // is logged for the operator and doesn't undo the deletion.
  try {
    await deleteUserFiles(userId);
  } catch (err) {
    logger.error("account.delete.files_failed", { userId, error: String(err) });
  }

  return NextResponse.json({ deleted: true });
}
