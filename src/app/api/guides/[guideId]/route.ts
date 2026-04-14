import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ guideId: string }> },
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { guideId } = await params;

  try {
    const guide = await prisma.studyGuide.findUnique({
      where: { id: guideId },
      select: { userId: true },
    });

    if (!guide || guide.userId !== userId) {
      return NextResponse.json({ error: "Guide not found" }, { status: 404 });
    }

    await prisma.studyGuide.delete({ where: { id: guideId } });
    logger.info("guide.deleted", { user_id: userId, guide_id: guideId });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
