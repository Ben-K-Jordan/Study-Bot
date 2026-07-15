import { prisma } from "@/lib/db";
import { Prisma } from "../../generated/prisma/client";

export interface EvidenceCardResult {
  id: string;
  claim: string;
  recommendation: string;
  boundaryConditions: string | null;
  strength: string;
  tags: string[];
  paper: {
    title: string;
    authors: string | null;
    year: number | null;
  };
}

/**
 * Query evidence cards by tags. Returns cards that match ANY of the given tags,
 * ordered by strength (STRONG first) then by relevance (number of matching tags).
 */
export async function queryEvidenceCards(
  tags: string[],
  options?: { strength?: "WEAK" | "MODERATE" | "STRONG"; limit?: number }
): Promise<EvidenceCardResult[]> {
  if (tags.length === 0) return [];

  const limit = options?.limit ?? 20;

  // Build WHERE with safe parameterization via Prisma.sql
  const strengthFilter = options?.strength
    ? Prisma.sql`AND c.strength = ${options.strength}`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<
    {
      id: string;
      claim: string;
      recommendation: string;
      boundary_conditions: string | null;
      strength: string;
      tags: unknown;
      paper_title: string;
      paper_authors: string | null;
      paper_year: number | null;
    }[]
  >(Prisma.sql`
    SELECT c.id, c.claim, c.recommendation, c.boundary_conditions, c.strength, c.tags,
           p.title AS paper_title, p.authors AS paper_authors, p.year AS paper_year
    FROM evidence_cards c
    JOIN evidence_papers p ON c.evidence_paper_id = p.id
    WHERE c.tags ?| ${tags}::text[]
      ${strengthFilter}
    ORDER BY
      CASE c.strength WHEN 'STRONG' THEN 3 WHEN 'MODERATE' THEN 2 WHEN 'WEAK' THEN 1 ELSE 0 END DESC,
      (SELECT COUNT(*) FROM jsonb_array_elements_text(c.tags) t WHERE t = ANY(${tags}::text[])) DESC
    LIMIT ${limit}
  `);

  return rows.map((row) => ({
    id: row.id,
    claim: row.claim,
    recommendation: row.recommendation,
    boundaryConditions: row.boundary_conditions,
    strength: row.strength,
    tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
    paper: {
      title: row.paper_title,
      authors: row.paper_authors,
      year: row.paper_year,
    },
  }));
}

/**
 * Get all unique tags across all evidence cards.
 */
export async function listEvidenceTags(): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ tag: string }[]>`
    SELECT DISTINCT jsonb_array_elements_text(tags) AS tag
    FROM evidence_cards
    WHERE tags IS NOT NULL
    ORDER BY tag
  `;
  return rows.map((r) => r.tag);
}

/**
 * Build a research context string for the plan generator prompt.
 * Retrieves evidence cards relevant to the given scheduling concerns
 * and formats them into a concise prompt section.
 */
export async function buildResearchContext(
  concerns: string[]
): Promise<string> {
  const cards = await queryEvidenceCards(concerns);
  if (cards.length === 0) return "";

  const lines = ["## Research-Based Scheduling Evidence\n"];

  for (const card of cards) {
    lines.push(`### [${card.strength}] ${card.paper.title} (${card.paper.authors}, ${card.paper.year})`);
    lines.push(`**Claim:** ${card.claim}`);
    lines.push(`**Recommendation:** ${card.recommendation}`);
    if (card.boundaryConditions) {
      lines.push(`**Boundary Conditions:** ${card.boundaryConditions}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
