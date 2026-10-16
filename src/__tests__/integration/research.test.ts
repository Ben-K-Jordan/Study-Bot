/**
 * Integration tests for the research evidence card query service.
 *
 * Needs Postgres through DATABASE_URL and is skipped without it, like the
 * other integration files. The file creates its own paper and three cards and
 * removes them afterwards. Every query uses tags unique to this run, so
 * research data loaded by `npm run db:seed-research` can't change the results.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

// Type-only references: the modules load in beforeAll.
let prisma: typeof import("@/lib/db").prisma | undefined;
let queryEvidenceCards: typeof import("@/services/research").queryEvidenceCards;
let buildResearchContext: typeof import("@/services/research").buildResearchContext;

const SYSTEM_USER_ID = "__system__";
const STAMP = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
/** On the STRONG and WEAK cards. */
const TAG_A = `test-tag-a-${STAMP}`;
/** On the MODERATE card only. */
const TAG_B = `test-tag-b-${STAMP}`;
const MISSING_TAG = `test-tag-missing-${STAMP}`;

const STRONG_CLAIM = "Spacing improves retention";
const MODERATE_CLAIM = "Retrieval practice is effective";
const WEAK_CLAIM = "Weak finding about font size";

describe.skipIf(!hasDb)("Integration: research evidence cards", () => {
  let testPaperId: string | undefined;
  let testDocId: string | undefined;

  beforeAll(async () => {
    // Imported here so nothing touches the database when the suite is skipped.
    const db = (await import("@/lib/db")).prisma;
    prisma = db;
    ({ queryEvidenceCards, buildResearchContext } = await import("@/services/research"));

    const doc = await db.contentDocument.create({
      data: {
        userId: SYSTEM_USER_ID,
        namespace: "RESEARCH",
        title: "Test Paper for Research Service",
        originalFilename: "test-paper.txt",
        mimeType: "text/plain",
        storageKey: `__test__/research/test-paper-${STAMP}.txt`,
        contentHash: `test-hash-${STAMP}`,
        status: "PROCESSED",
      },
    });
    testDocId = doc.id;

    const paper = await db.evidencePaper.create({
      data: {
        userId: SYSTEM_USER_ID,
        title: "Test Paper for Research Service",
        authors: "Test Author",
        year: 2024,
        venue: "Test Journal",
        documentId: doc.id,
        tags: ["spacing", TAG_A, TAG_B],
      },
    });
    testPaperId = paper.id;

    // The cards keep realistic tags such as "spacing" too; the tests never
    // query those, because seeded research cards share them.
    await db.evidenceCard.createMany({
      data: [
        {
          evidencePaperId: paper.id,
          claim: STRONG_CLAIM,
          recommendation: "Space sessions 1-2 days apart",
          boundaryConditions: "Only for declarative knowledge",
          strength: "STRONG",
          tags: ["spacing", "scheduling", TAG_A],
        },
        {
          evidencePaperId: paper.id,
          claim: MODERATE_CLAIM,
          recommendation: "Use active recall",
          boundaryConditions: null,
          strength: "MODERATE",
          tags: ["retrieval-practice", "active-learning", TAG_B],
        },
        {
          evidencePaperId: paper.id,
          claim: WEAK_CLAIM,
          recommendation: "Use larger fonts maybe",
          boundaryConditions: "Very limited evidence",
          strength: "WEAK",
          tags: ["font-size", TAG_A],
        },
      ],
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    if (testPaperId) {
      await prisma.evidenceCard.deleteMany({ where: { evidencePaperId: testPaperId } });
      await prisma.evidencePaper.delete({ where: { id: testPaperId } });
    }
    if (testDocId) await prisma.contentDocument.delete({ where: { id: testDocId } });
  });

  describe("queryEvidenceCards", () => {
    it("returns every card matching any of the given tags, and only those", async () => {
      const both = await queryEvidenceCards([TAG_A, TAG_B]);
      expect(both.map((c) => c.claim).sort()).toEqual([MODERATE_CLAIM, STRONG_CLAIM, WEAK_CLAIM].sort());

      const onlyB = await queryEvidenceCards([TAG_B]);
      expect(onlyB.map((c) => c.claim)).toEqual([MODERATE_CLAIM]);
      expect(onlyB[0].tags).toContain(TAG_B);
    });

    it("returns an empty array for a tag no card has", async () => {
      expect(await queryEvidenceCards([MISSING_TAG])).toEqual([]);
    });

    it("returns an empty array for empty tags input", async () => {
      expect(await queryEvidenceCards([])).toEqual([]);
    });

    it("sorts STRONG cards before MODERATE before WEAK", async () => {
      const results = await queryEvidenceCards([TAG_A, TAG_B]);
      const strong = results.findIndex((c) => c.claim === STRONG_CLAIM);
      const moderate = results.findIndex((c) => c.claim === MODERATE_CLAIM);
      const weak = results.findIndex((c) => c.claim === WEAK_CLAIM);

      // All three must be present before their order means anything.
      expect(strong).not.toBe(-1);
      expect(moderate).not.toBe(-1);
      expect(weak).not.toBe(-1);
      expect(strong).toBeLessThan(moderate);
      expect(moderate).toBeLessThan(weak);
      expect(results.map((c) => c.strength)).toEqual(["STRONG", "MODERATE", "WEAK"]);
    });

    it("filters by strength when specified", async () => {
      const results = await queryEvidenceCards([TAG_A, TAG_B], { strength: "STRONG" });
      expect(results.map((c) => c.claim)).toEqual([STRONG_CLAIM]);
      expect(results[0].strength).toBe("STRONG");
    });

    it("respects the limit option, keeping the strongest card", async () => {
      const results = await queryEvidenceCards([TAG_A, TAG_B], { limit: 1 });
      expect(results.map((c) => c.claim)).toEqual([STRONG_CLAIM]);
    });

    it("includes paper metadata in results", async () => {
      const results = await queryEvidenceCards([TAG_A]);
      const testCard = results.find((c) => c.claim === STRONG_CLAIM);
      expect(testCard).toBeDefined();
      expect(testCard!.paper).toEqual({
        title: "Test Paper for Research Service",
        authors: "Test Author",
        year: 2024,
      });
    });
  });

  describe("buildResearchContext", () => {
    it("formats the matching cards, strongest first", async () => {
      const context = await buildResearchContext([TAG_A]);
      expect(context).toContain("Research-Based Scheduling Evidence");
      expect(context).toContain(STRONG_CLAIM);
      expect(context).toContain(WEAK_CLAIM);
      expect(context).not.toContain(MODERATE_CLAIM);
      expect(context).toContain("[STRONG]");
      expect(context).toContain("Recommendation:");
      expect(context.indexOf(STRONG_CLAIM)).toBeLessThan(context.indexOf(WEAK_CLAIM));
    });

    it("returns an empty string when no cards match", async () => {
      expect(await buildResearchContext([MISSING_TAG])).toBe("");
    });
  });
});
