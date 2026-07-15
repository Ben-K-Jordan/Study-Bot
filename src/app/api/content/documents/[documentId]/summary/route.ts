import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { documentId } = await params;

  const doc = await prisma.contentDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      userId: true,
      title: true,
      summary: true,
      suggestedQuestions: true,
      status: true,
    },
  });

  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  if (doc.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    document_id: doc.id,
    title: doc.title,
    summary: doc.summary ?? null,
    suggested_questions: (doc.suggestedQuestions as string[] | null) ?? null,
    status: doc.status,
  });
}
