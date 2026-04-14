import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * GET /api/learn — returns per-course learning data for the study hub.
 * Each course shows: document count, flashcard decks, due cards, guides, recent XP.
 */
export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch all user courses from documents
    const docs = await prisma.contentDocument.findMany({
      where: { userId, namespace: "COURSE", courseName: { not: null } },
      select: { courseName: true, examName: true, status: true },
    });

    // Unique courses
    const courseMap = new Map<string, { examNames: Set<string>; docCount: number; processedCount: number }>();
    for (const doc of docs) {
      if (!doc.courseName) continue;
      const existing = courseMap.get(doc.courseName) || { examNames: new Set(), docCount: 0, processedCount: 0 };
      existing.docCount++;
      if (doc.status === "PROCESSED") existing.processedCount++;
      if (doc.examName) existing.examNames.add(doc.examName);
      courseMap.set(doc.courseName, existing);
    }

    if (courseMap.size === 0) {
      return NextResponse.json({ courses: [], hasCourses: false });
    }

    const courseNames = Array.from(courseMap.keys());

    // Fetch flashcard decks, due cards, guides, and recent XP in parallel
    const now = new Date();
    const [decks, dueCards, guides, recentXp] = await Promise.all([
      prisma.flashcardDeck.groupBy({
        by: ["courseName"],
        where: { userId, courseName: { in: courseNames } },
        _count: { id: true },
      }),
      prisma.flashcard.findMany({
        where: {
          deck: { userId, courseName: { in: courseNames } },
          OR: [
            { nextDueAt: null, repetitions: 0 }, // new cards
            { nextDueAt: { lte: now } },           // due cards
          ],
        },
        select: { deck: { select: { courseName: true } } },
      }),
      prisma.studyGuide.groupBy({
        by: ["courseName"],
        where: { userId, courseName: { in: courseNames } },
        _count: { id: true },
      }),
      prisma.xpEvent.groupBy({
        by: ["action"],
        where: {
          userId,
          createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
        _sum: { xpAmount: true },
      }),
    ]);

    // Aggregate due cards per course
    const duePerCourse = new Map<string, number>();
    for (const card of dueCards) {
      const cn = card.deck.courseName;
      duePerCourse.set(cn, (duePerCourse.get(cn) || 0) + 1);
    }

    // Build deck count map
    const deckCountMap = new Map<string, number>();
    for (const d of decks) {
      deckCountMap.set(d.courseName, d._count.id);
    }

    // Build guide count map
    const guideCountMap = new Map<string, number>();
    for (const g of guides) {
      guideCountMap.set(g.courseName, g._count.id);
    }

    // Weekly XP total
    const weeklyXp = recentXp.reduce((sum, e) => sum + (e._sum.xpAmount || 0), 0);

    const courses = courseNames.map((name) => {
      const info = courseMap.get(name)!;
      return {
        courseName: name,
        examNames: Array.from(info.examNames),
        docCount: info.docCount,
        processedDocCount: info.processedCount,
        deckCount: deckCountMap.get(name) || 0,
        dueCardCount: duePerCourse.get(name) || 0,
        guideCount: guideCountMap.get(name) || 0,
      };
    });

    // Sort by most due cards first, then most recent activity
    courses.sort((a, b) => b.dueCardCount - a.dueCardCount || b.docCount - a.docCount);

    return NextResponse.json({ courses, hasCourses: true, weeklyXp });
  } catch (err) {
    logger.error("learn.fetch_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
