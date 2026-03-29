import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const tagsParam = searchParams.get("tags");

  // Build query — cards are accessed through papers which have userId
  const where: Record<string, unknown> = {
    paper: { userId },
  };

  // Filter by tags if provided (comma-separated)
  // We use Prisma JSON filtering to match any of the provided tags
  if (tagsParam) {
    const tags = tagsParam.split(",").map((t) => t.trim()).filter(Boolean);
    if (tags.length > 0) {
      where.tags = { hasSome: tags };
    }
  }

  const cards = await prisma.evidenceCard.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      paper: {
        select: { id: true, title: true, authors: true, year: true },
      },
    },
  });

  return NextResponse.json({
    cards: cards.map((c) => ({
      card_id: c.id,
      paper_id: c.evidencePaperId,
      paper_title: c.paper.title,
      paper_authors: c.paper.authors,
      paper_year: c.paper.year,
      claim: c.claim,
      recommendation: c.recommendation,
      boundary_conditions: c.boundaryConditions,
      strength: c.strength,
      tags: c.tags,
      created_at: c.createdAt.toISOString(),
    })),
  });
}
