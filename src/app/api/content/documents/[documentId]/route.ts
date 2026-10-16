import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { deleteDocument } from "@/services/content";
import { logger } from "@/lib/logger";
import { unauthorized } from "@/lib/http";

/**
 * DELETE /api/content/documents/{id}: delete one course file, its sections
 * and the stored file. Decks made from it stay.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const { documentId } = await params;

  try {
    const result = await deleteDocument(userId, documentId);
    if ("data" in result) return NextResponse.json(result.data);

    if (result.error === "not_course_material") {
      return NextResponse.json(
        { error: "Research papers can't be deleted here.", code: result.error },
        { status: 409 },
      );
    }
    // Another account's file reads as missing, so ids can't be probed
    return NextResponse.json(
      { error: "This file isn't in your materials anymore.", code: "not_found" },
      { status: 404 },
    );
  } catch (err) {
    logger.error("document_delete_failed", { document_id: documentId, error: String(err) });
    return NextResponse.json(
      { error: "File not deleted. Retry in a minute.", code: "internal" },
      { status: 500 },
    );
  }
}
