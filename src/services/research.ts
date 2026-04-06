import { prisma } from "@/lib/db";

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

  const cards = await prisma.evidenceCard.findMany({
    where: {
      ...(options?.strength ? { strength: options.strength } : {}),
    },
    include: {
      paper: {
        select: { title: true, authors: true, year: true },
      },
    },
  });

  // Filter cards that have at least one matching tag
  const matched = cards
    .map((card) => {
      const cardTags = Array.isArray(card.tags) ? (card.tags as string[]) : [];
      const matchCount = tags.filter((t) => cardTags.includes(t)).length;
      return { card, matchCount };
    })
    .filter(({ matchCount }) => matchCount > 0);

  // Sort: STRONG > MODERATE > WEAK, then by match count desc
  const strengthOrder: Record<string, number> = { STRONG: 3, MODERATE: 2, WEAK: 1 };
  matched.sort((a, b) => {
    const sa = strengthOrder[a.card.strength] ?? 0;
    const sb = strengthOrder[b.card.strength] ?? 0;
    if (sb !== sa) return sb - sa;
    return b.matchCount - a.matchCount;
  });

  return matched.slice(0, limit).map(({ card }) => ({
    id: card.id,
    claim: card.claim,
    recommendation: card.recommendation,
    boundaryConditions: card.boundaryConditions,
    strength: card.strength,
    tags: Array.isArray(card.tags) ? (card.tags as string[]) : [],
    paper: card.paper,
  }));
}

/**
 * Get all unique tags across all evidence cards.
 */
export async function listEvidenceTags(): Promise<string[]> {
  const cards = await prisma.evidenceCard.findMany({
    select: { tags: true },
  });

  const tagSet = new Set<string>();
  for (const card of cards) {
    const cardTags = Array.isArray(card.tags) ? (card.tags as string[]) : [];
    for (const tag of cardTags) tagSet.add(tag);
  }

  return Array.from(tagSet).sort();
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
