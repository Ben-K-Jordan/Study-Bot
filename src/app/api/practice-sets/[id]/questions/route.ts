import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const set = await prisma.practiceSet.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!set) {
    return NextResponse.json({ error: "Practice set not found" }, { status: 404 });
  }
  if (set.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    practice_set_id: set.id,
    title: set.title,
    questions: set.questions.map((q) => ({
      question_id: q.id,
      kind: q.kind,
      prompt_text: q.promptText,
      answer_key: q.answerKey,
      solution_steps: q.solutionSteps,
      tags: q.tags,
      created_at: q.createdAt.toISOString(),
    })),
  });
}
