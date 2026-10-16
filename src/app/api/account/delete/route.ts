import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
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

const NOT_DELETED = "Account not deleted. Confirm in the dialog and retry.";
const WRONG_PASSWORD = "That password doesn't match your account. Check it and retry.";
/** Owner of the AI spend rows a deleted account leaves behind. */
const DELETED_ACCOUNT_ID = "deleted";

/**
 * The Google token to revoke once the account is gone, read before the
 * rows are deleted. Null when there is no connection or the token can't be
 * read (the fake provider's placeholder, a rotated key).
 */
async function googleTokenToRevoke(userId: string): Promise<string | null> {
  try {
    const integration = await prisma.googleIntegration.findUnique({
      where: { userId },
      select: { accessTokenEncrypted: true, refreshTokenEncrypted: true },
    });
    const encrypted = integration?.refreshTokenEncrypted ?? integration?.accessTokenEncrypted;
    return encrypted ? decryptToken(encrypted) : null;
  } catch {
    return null;
  }
}

/**
 * Best effort: revoke Study Bot's Google access so the deleted account
 * doesn't leave a live grant at Google. Runs only after the deletion
 * commits: a revoke can't be undone, and revoking before a failed delete
 * would leave a calendar that shows as connected but no longer works.
 */
async function revokeGoogleAccess(userId: string, token: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    // The tokens are already deleted; the student can remove the grant from
    // their Google Account if this didn't reach Google.
    logger.warn("account.delete.google_revoke_failed", { userId, error: String(err) });
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
    return unauthorized();
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
    return unauthorized();
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

  // Read now, while the row exists; the revoke itself waits for the commit.
  const googleToken = await googleTokenToRevoke(userId);

  try {
    await prisma.$transaction(async (tx) => {
      // Phase 1: Leaf models with userId (no children, or children cascade)
      await Promise.all([
        tx.cardReview.deleteMany({ where: { userId } }),
        tx.xpEvent.deleteMany({ where: { userId } }),
        tx.achievement.deleteMany({ where: { userId } }),
        tx.objectiveMastery.deleteMany({ where: { userId } }),
        // Spend rows stay, detached from the account: they hold no content,
        // and the cap across all accounts (AI_GLOBAL_DAILY_COST_CAP_USD) sums
        // them, so deleting an account can't hand back today's spend.
        tx.aiCallLog.updateMany({ where: { userId }, data: { userId: DELETED_ACCOUNT_ID } }),
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

  if (googleToken) await revokeGoogleAccess(userId, googleToken);

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
