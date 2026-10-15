/**
 * DELETE /api/guides/{guideId}: deletes a guide the user owns.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { deleteStudyGuide } from "@/services/study-guides";
import { unauthorized } from "@/app/api/learn/responses";

const paramsSchema = z.object({ guideId: z.string().trim().min(1).max(64) });

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ guideId: string }> },
) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) {
    return NextResponse.json({ error: "This guide doesn't exist.", code: "NOT_FOUND" }, { status: 404 });
  }

  try {
    const deleted = await deleteStudyGuide(userId, parsed.data.guideId);
    if (!deleted) {
      return NextResponse.json(
        { error: "This guide was already deleted or belongs to another account.", code: "NOT_FOUND" },
        { status: 404 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error("guides.delete_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Guide not deleted. Retry.", code: "INTERNAL" }, { status: 500 });
  }
}
