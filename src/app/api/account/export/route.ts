import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { plural } from "@/lib/format";
import { createRateLimiter } from "@/lib/rate-limit";

// Exports are heavy reads, so they get their own budget instead of sharing
// the AI limiter (an export no longer blocks generating a deck, or the reverse).
const exportLimiter = createRateLimiter("account-export", {
  maxRequests: 3,
  windowMs: 60 * 1000,
});

/**
 * GET /api/account/export
 * Data export: returns everything the student owns as a JSON attachment.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  const rl = exportLimiter.check(userId);
  if (!rl.allowed) {
    const seconds = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return NextResponse.json(
      {
        error: `Too many exports. Retry in ${plural(seconds, { one: "# second", other: "# seconds" })}.`,
        retry_after_seconds: seconds,
      },
      { status: 429, headers: { "Retry-After": String(seconds) } },
    );
  }

  try {
    const [
      user,
      studyPlans,
      sessions,
      flashcardDecks,
      chatMessages,
      userGameState,
      aiCallLogs,
      contentDocuments,
      objectiveAnchors,
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
    };

    logger.info("account.export.success", { userId });

    // Some columns are BigInt (AI call costs, Google token expiry), which
    // JSON.stringify refuses; write them as decimal strings.
    const body = JSON.stringify(exportData, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );

    return new NextResponse(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="study-bot-export-${Date.now()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error("account.export.failed", { userId, error: String(err) });
    return NextResponse.json(
      { error: "Data not exported. Check your connection and retry." },
      { status: 500 },
    );
  }
}
