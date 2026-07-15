import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createPracticeSetSchema } from "@/lib/validation-content";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
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

  try {
    const parsed = createPracticeSetSchema.parse(body);

    const set = await prisma.practiceSet.create({
      data: {
        userId,
        courseName: parsed.course_name,
        examName: parsed.exam_name ?? null,
        title: parsed.title,
      },
    });

    return NextResponse.json(
      {
        practice_set_id: set.id,
        course_name: set.courseName,
        exam_name: set.examName,
        title: set.title,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    logger.error("create_practice_set_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const courseName = searchParams.get("course_name") || undefined;
  const examName = searchParams.get("exam_name") || undefined;
  const limitRaw = parseInt(searchParams.get("limit") || "50", 10);
  const limit = Math.max(1, Math.min(Number.isNaN(limitRaw) ? 50 : limitRaw, 100));
  const cursor = searchParams.get("cursor") || undefined;

  const where: Record<string, unknown> = { userId };
  if (courseName) where.courseName = courseName;
  if (examName) where.examName = examName;

  const sets = await prisma.practiceSet.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { questions: true } } },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = sets.length > limit;
  const items = hasMore ? sets.slice(0, limit) : sets;
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return NextResponse.json({
    practice_sets: items.map((s) => ({
      practice_set_id: s.id,
      course_name: s.courseName,
      exam_name: s.examName,
      title: s.title,
      question_count: s._count.questions,
      created_at: s.createdAt.toISOString(),
    })),
    next_cursor: nextCursor,
  }, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
