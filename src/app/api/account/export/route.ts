import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { aiLimiter, tooManyRequests } from "@/lib/rate-limit";

/**
 * GET /api/account/export
 * GDPR data export: returns all user data as a downloadable JSON file.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  try {
    const [
      user,
      studyPlans,
      sessions,
      flashcardDecks,
      chatMessages,
      notificationPreference,
      pushSubscriptions,
      scheduledReminders,
      userGameState,
      aiCallLogs,
      contentDocuments,
      objectiveAnchors,
      practiceSets,
      evidencePapers,
      planReflowAudits,
      planCalendarPublications,
      planItemExternalEvents,
      googleIntegration,
      objectiveMastery,
      studyGuides,
      cardReviews,
      xpEvents,
      achievements,
      sessionErrorLogs,
    ] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        omit: { passwordHash: true },
      }),

      prisma.studyPlan.findMany({
        where: { userId },
        include: { items: true },
      }),

      prisma.session.findMany({
        where: { userId },
        include: { runs: { include: { attempts: true, runPrompts: true } } },
      }),

      prisma.flashcardDeck.findMany({
        where: { userId },
        include: { cards: true },
      }),

      prisma.chatMessage.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),

      prisma.notificationPreference.findUnique({
        where: { userId },
      }),

      prisma.pushSubscription.findMany({
        where: { userId },
        omit: { auth: true, p256dh: true },
      }),

      prisma.scheduledReminder.findMany({
        where: { userId },
      }),

      prisma.userGameState.findUnique({
        where: { userId },
      }),

      prisma.aiCallLog.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),

      prisma.contentDocument.findMany({
        where: { userId },
        include: { chunks: { omit: { text: false } } },
      }),

      prisma.objectiveAnchor.findMany({
        where: { userId },
      }),

      prisma.practiceSet.findMany({
        where: { userId },
        include: { questions: true },
      }),

      prisma.evidencePaper.findMany({
        where: { userId },
        include: { cards: true },
      }),

      prisma.planReflowAudit.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),

      prisma.planCalendarPublication.findMany({
        where: { userId },
      }),

      prisma.planItemExternalEvent.findMany({
        where: { userId },
      }),

      prisma.googleIntegration.findUnique({
        where: { userId },
        omit: { accessTokenEncrypted: true, refreshTokenEncrypted: true },
      }),

      prisma.objectiveMastery.findMany({
        where: { userId },
      }),

      prisma.studyGuide.findMany({
        where: { userId },
      }),

      prisma.cardReview.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),

      prisma.xpEvent.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),

      prisma.achievement.findMany({
        where: { userId },
      }),

      prisma.sessionErrorLog.findMany({
        where: { userId },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      user,
      studyPlans,
      sessions,
      contentDocuments,
      flashcardDecks,
      practiceSets,
      evidencePapers,
      objectiveAnchors,
      objectiveMastery,
      studyGuides,
      cardReviews,
      sessionErrorLogs,
      chatMessages,
      xpEvents,
      achievements,
      userGameState,
      aiCallLogs,
      planReflowAudits,
      planCalendarPublications,
      planItemExternalEvents,
      googleIntegration,
      notificationPreference,
      pushSubscriptions,
      scheduledReminders,
    };

    logger.info("account.export.success", { userId });

    return NextResponse.json(exportData, {
      headers: {
        "Content-Disposition": `attachment; filename="study-bot-export-${Date.now()}.json"`,
      },
    });
  } catch (err) {
    logger.error("account.export.failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
