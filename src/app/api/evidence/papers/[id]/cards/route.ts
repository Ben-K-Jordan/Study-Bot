import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { createEvidenceCardSchema } from "@/lib/validation-content";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Verify ownership
  const paper = await prisma.evidencePaper.findUnique({ where: { id } });
  if (!paper) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }
  if (paper.userId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const parsed = createEvidenceCardSchema.parse(body);

    const card = await prisma.evidenceCard.create({
      data: {
        evidencePaperId: id,
        claim: parsed.claim,
        recommendation: parsed.recommendation,
        boundaryConditions: parsed.boundary_conditions ?? null,
        strength: parsed.strength,
        tags: (parsed.tags as string[]) ?? undefined,
      },
    });

    return NextResponse.json(
      {
        card_id: card.id,
        paper_id: id,
        claim: card.claim,
        strength: card.strength,
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
    logger.error("create_evidence_card_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
