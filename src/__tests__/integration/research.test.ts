/**
 * Unit tests for the research evidence card query service.
 *
 * Uses the real database — requires Postgres with seeded research data.
 * Run `npm run db:seed-research` before running these tests.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import {
  queryEvidenceCards,
  listEvidenceTags,
  buildResearchContext,
} from "@/services/research";

const SYSTEM_USER_ID = "__system__";

// ---- Test Data Setup ----

let testPaperId: string;
let testDocId: string;

beforeAll(async () => {
  // Create a minimal test document + paper + cards
  const doc = await prisma.contentDocument.create({
    data: {
      userId: SYSTEM_USER_ID,
      namespace: "RESEARCH",
      title: "Test Paper for Research Service",
      originalFilename: "test-paper.txt",
      mimeType: "text/plain",
      storageKey: "__test__/research/test-paper.txt",
      contentHash: `test-hash-${Date.now()}`,
      status: "PROCESSED",
    },
  });
  testDocId = doc.id;

  const paper = await prisma.evidencePaper.create({
    data: {
      userId: SYSTEM_USER_ID,
      title: "Test Paper for Research Service",
      authors: "Test Author",
      year: 2024,
      venue: "Test Journal",
      documentId: doc.id,
      tags: ["spacing", "test-tag"],
    },
  });
  testPaperId = paper.id;

  await prisma.evidenceCard.createMany({
    data: [
      {
        evidencePaperId: paper.id,
        claim: "Spacing improves retention",
        recommendation: "Space sessions 1-2 days apart",
        boundaryConditions: "Only for declarative knowledge",
        strength: "STRONG",
        tags: ["spacing", "scheduling"],
      },
      {
        evidencePaperId: paper.id,
        claim: "Retrieval practice is effective",
        recommendation: "Use active recall",
        boundaryConditions: null,
        strength: "MODERATE",
        tags: ["retrieval-practice", "active-learning"],
      },
      {
        evidencePaperId: paper.id,
        claim: "Weak finding about font size",
        recommendation: "Use larger fonts maybe",
        boundaryConditions: "Very limited evidence",
        strength: "WEAK",
        tags: ["font-size", "test-tag"],
      },
    ],
  });
});

afterAll(async () => {
  // Clean up test data
  await prisma.evidenceCard.deleteMany({ where: { evidencePaperId: testPaperId } });
  await prisma.evidencePaper.delete({ where: { id: testPaperId } });
  await prisma.contentDocument.delete({ where: { id: testDocId } });
});

// ---- Tests ----

describe("queryEvidenceCards", () => {
  it("returns cards matching any of the given tags", async () => {
    const results = await queryEvidenceCards(["spacing"]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const card of results) {
      expect(card.tags).toContain("spacing");
    }
  });

  it("returns empty array for no matching tags", async () => {
    const results = await queryEvidenceCards(["nonexistent-tag-xyz"]);
    expect(results).toEqual([]);
  });

  it("returns empty array for empty tags input", async () => {
    const results = await queryEvidenceCards([]);
    expect(results).toEqual([]);
  });

  it("sorts STRONG cards before MODERATE before WEAK", async () => {
    const results = await queryEvidenceCards(["spacing", "retrieval-practice", "font-size", "test-tag"]);
    expect(results.length).toBeGreaterThanOrEqual(3);

    // Find our test cards
    const strong = results.findIndex((c) => c.claim === "Spacing improves retention");
    const moderate = results.findIndex((c) => c.claim === "Retrieval practice is effective");
    const weak = results.findIndex((c) => c.claim === "Weak finding about font size");

    if (strong !== -1 && moderate !== -1) expect(strong).toBeLessThan(moderate);
    if (moderate !== -1 && weak !== -1) expect(moderate).toBeLessThan(weak);
  });

  it("filters by strength when specified", async () => {
    const results = await queryEvidenceCards(["spacing", "test-tag"], { strength: "STRONG" });
    for (const card of results) {
      expect(card.strength).toBe("STRONG");
    }
  });

  it("respects limit option", async () => {
    const results = await queryEvidenceCards(["spacing", "retrieval-practice", "test-tag"], { limit: 1 });
    expect(results.length).toBe(1);
  });

  it("includes paper metadata in results", async () => {
    const results = await queryEvidenceCards(["spacing"]);
    const testCard = results.find((c) => c.claim === "Spacing improves retention");
    expect(testCard).toBeDefined();
    expect(testCard!.paper.title).toBe("Test Paper for Research Service");
    expect(testCard!.paper.authors).toBe("Test Author");
    expect(testCard!.paper.year).toBe(2024);
  });
});

describe("listEvidenceTags", () => {
  it("returns sorted unique tags", async () => {
    const tags = await listEvidenceTags();
    expect(tags.length).toBeGreaterThanOrEqual(1);
    // Check sorted
    for (let i = 1; i < tags.length; i++) {
      expect(tags[i] >= tags[i - 1]).toBe(true);
    }
  });

  it("includes tags from test data", async () => {
    const tags = await listEvidenceTags();
    expect(tags).toContain("spacing");
    expect(tags).toContain("test-tag");
  });
});

describe("buildResearchContext", () => {
  it("returns formatted context string for matching concerns", async () => {
    const context = await buildResearchContext(["spacing"]);
    expect(context).toContain("Research-Based Scheduling Evidence");
    expect(context).toContain("Spacing improves retention");
    expect(context).toContain("[STRONG]");
    expect(context).toContain("Recommendation:");
  });

  it("returns empty string when no cards match", async () => {
    const context = await buildResearchContext(["nonexistent-tag-xyz"]);
    expect(context).toBe("");
  });
});
