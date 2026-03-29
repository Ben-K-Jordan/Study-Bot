import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { importQuestionsSchema } from "@/lib/validation-content";
import { z } from "zod/v4";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const set = await prisma.practiceSet.findUnique({ where: { id } });
  if (!set) {
    return NextResponse.json({ error: "Practice set not found" }, { status: 404 });
  }
  if (set.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const parsed = importQuestionsSchema.parse(body);

    const created = await prisma.$transaction(
      parsed.questions.map((q) =>
        prisma.practiceQuestion.create({
          data: {
            practiceSetId: id,
            kind: q.kind,
            promptText: q.prompt_text,
            answerKey: q.answer_key ?? null,
            solutionSteps: q.solution_steps ?? null,
            tags: q.tags ? (q.tags as object) : undefined,
          },
        })
      )
    );

    return NextResponse.json(
      { imported_count: created.length },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("Import questions failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
