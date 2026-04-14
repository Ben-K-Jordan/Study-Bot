import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const deleteSchema = z.object({
  confirm: z.literal("DELETE MY ACCOUNT"),
});

/**
 * DELETE /api/account/delete
 * GDPR account deletion: permanently deletes the user and all associated data.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed. Body must include { confirm: \"DELETE MY ACCOUNT\" }.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

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
        tx.scheduledReminder.deleteMany({ where: { userId } }),
        tx.chatMessage.deleteMany({ where: { userId } }),
        tx.pushSubscription.deleteMany({ where: { userId } }),
        tx.notificationPreference.deleteMany({ where: { userId } }),
        tx.verificationToken.deleteMany({ where: { userId } }),
      ]);

      // Phase 2: Child models without userId (filter via parent relation)
      await Promise.all([
        tx.sessionAttempt.deleteMany({ where: { run: { userId } } }),
        tx.studyPlanItem.deleteMany({ where: { plan: { userId } } }),
      ]);

      // Phase 3: Parent models with userId (their cascading children are gone)
      await Promise.all([
        tx.practiceSet.deleteMany({ where: { userId } }),
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

    logger.info("account.deleted", { userId });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    logger.error("account.delete.failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
