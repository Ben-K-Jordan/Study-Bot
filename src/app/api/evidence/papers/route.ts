import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createEvidencePaperSchema } from "@/lib/validation-content";
import { z } from "zod/v4";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
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
    const parsed = createEvidencePaperSchema.parse(body);

    // Verify the linked document exists and belongs to user
    const doc = await prisma.contentDocument.findUnique({
      where: { id: parsed.document_id },
    });
    if (!doc) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (doc.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (doc.namespace !== "RESEARCH") {
      return NextResponse.json(
        { error: "Document must be in RESEARCH namespace" },
        { status: 400 }
      );
    }

    const paper = await prisma.evidencePaper.create({
      data: {
        userId,
        title: parsed.title,
        authors: parsed.authors ?? null,
        year: parsed.year ?? null,
        venue: parsed.venue ?? null,
        documentId: parsed.document_id,
        tags: (parsed.tags as string[]) ?? undefined,
      },
    });

    return NextResponse.json(
      {
        paper_id: paper.id,
        title: paper.title,
        document_id: paper.documentId,
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
    console.error("Create evidence paper failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
