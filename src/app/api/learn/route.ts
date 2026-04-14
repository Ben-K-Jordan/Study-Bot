import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const docs = await prisma.contentDocument.findMany({
      where: { userId, namespace: "COURSE", courseName: { not: null } },
      select: { courseName: true, examName: true, status: true },
    });

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
    const now = new Date();

    const [decks, dueNewCards, dueReviewCards, guides, recentXp] = await Promise.all([
      prisma.flashcardDeck.groupBy({
        by: ["courseName"],
        where: { userId, courseName: { in: courseNames } },
        _count: { id: true },
      }),
      // Count new cards (never reviewed) per course via deck groupBy
      prisma.flashcard.groupBy({
        by: ["deckId"],
        where: {
          deck: { userId, courseName: { in: courseNames } },
          nextDueAt: null,
          repetitions: 0,
        },
        _count: { id: true },
      }),
      // Count due review cards per course via deck groupBy
      prisma.flashcard.groupBy({
        by: ["deckId"],
        where: {
          deck: { userId, courseName: { in: courseNames } },
          nextDueAt: { lte: now },
        },
        _count: { id: true },
      }),
      prisma.studyGuide.groupBy({
        by: ["courseName"],
        where: { userId, courseName: { in: courseNames } },
        _count: { id: true },
      }),
      prisma.xpEvent.aggregate({
        where: {
          userId,
          createdAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) },
        },
        _sum: { xpAmount: true },
      }),
    ]);

    // Need deck → course mapping to aggregate due cards by course
    const deckCourseMap = new Map<string, string>();
    const allDecks = await prisma.flashcardDeck.findMany({
      where: { userId, courseName: { in: courseNames } },
      select: { id: true, courseName: true },
    });
    for (const d of allDecks) deckCourseMap.set(d.id, d.courseName);

    const duePerCourse = new Map<string, number>();
    for (const g of [...dueNewCards, ...dueReviewCards]) {
      const cn = deckCourseMap.get(g.deckId);
      if (cn) duePerCourse.set(cn, (duePerCourse.get(cn) || 0) + g._count.id);
    }

    const deckCountMap = new Map(decks.map((d) => [d.courseName, d._count.id]));
    const guideCountMap = new Map(guides.map((g) => [g.courseName, g._count.id]));

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

    courses.sort((a, b) => b.dueCardCount - a.dueCardCount || b.docCount - a.docCount);

    return NextResponse.json({
      courses,
      hasCourses: true,
      weeklyXp: recentXp._sum.xpAmount || 0,
    });
  } catch (err) {
    logger.error("learn.fetch_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
