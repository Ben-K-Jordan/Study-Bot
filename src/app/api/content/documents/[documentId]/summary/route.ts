import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { unauthorized } from "@/lib/http";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
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

  if (!doc || doc.userId !== userId) {
    // Another account's file reads as missing, so ids can't be probed
    return NextResponse.json(
      { error: "This file isn't in your materials anymore.", code: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    document_id: doc.id,
    title: doc.title,
    summary: doc.summary ?? null,
    suggested_questions: (doc.suggestedQuestions as string[] | null) ?? null,
    status: doc.status,
  });
}
