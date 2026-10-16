/**
 * Integration tests for full-text search match modes.
 *
 * match "all" needs every query word in one chunk, so a natural question
 * whose answer is in the materials still found nothing ("Your materials
 * don't cover this" when they did). match "any" finds it, and its floor
 * keeps an off-topic question, or one that shares a single stray word,
 * from turning up a citation. Requires a running PostgreSQL database: set
 * DATABASE_URL to a test database before running.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";

const hasDb = !!process.env.DATABASE_URL;

let prisma: any;
let searchChunks: any;
let buildFeedbackQuery: any;

const USER = "test_search_match_" + Date.now();
const COURSE = "SEARCH_CS_" + Date.now();

const DOC_CONTENT = `
Introduction to Loop Invariants

A loop invariant is a condition that is true before and after each iteration of a loop.

To prove a loop is correct, you must show three things:
1. Initialization: The invariant is true before the first iteration.
2. Maintenance: If the invariant is true before an iteration, it remains true after.
3. Termination: When the loop terminates, the invariant gives a useful property.

Example: Binary Search
The loop invariant for binary search is that the target element, if present, must be between low and high.
`.trim();

describe.skipIf(!hasDb)("searchChunks match modes", () => {
  beforeAll(async () => {
    prisma = (await import("@/lib/db")).prisma;
    const search = await import("@/lib/search");
    searchChunks = search.searchChunks;
    buildFeedbackQuery = search.buildFeedbackQuery;
    const content = await import("@/services/content");
    const upload = await content.uploadDocument(
      USER, "COURSE", COURSE, undefined,
      "loops.txt", "loops.txt", "text/plain",
      Buffer.from(DOC_CONTENT),
    );
    await content.processDocument(USER, upload.document_id);
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.contentChunk.deleteMany({ where: { document: { userId: USER } } });
    await prisma.contentDocument.deleteMany({ where: { userId: USER } });
    await prisma.$disconnect();
  });

  const search = (q: string, match?: "all" | "any") =>
    searchChunks({ userId: USER, q, namespace: "COURSE", courseName: COURSE, match });

  it("finds the passage that answers a question even when it lacks some of the question's words", async () => {
    // "guarantee" is nowhere in the file, so requiring every word misses.
    const question = "What does a loop invariant guarantee when the loop terminates?";
    expect(await search(question, "all")).toEqual([]);

    const results = await search(question, "any");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].doc_title).toBeTruthy();
    expect(results[0].snippet).toMatch(/<<\w+>>/);
  });

  it("finds sources for a feedback query built from a templated question", async () => {
    const q = buildFeedbackQuery(
      "From memory: explain Loop invariants in 3 to 5 bullets.",
      "An invariant must hold before the first iteration and after every iteration",
      "Loop invariants",
    );
    expect(await search(q, "all")).toEqual([]);
    expect((await search(q, "any")).length).toBeGreaterThan(0);
  });

  it("returns nothing for an off-topic question", async () => {
    expect(await search("How do I bake sourdough bread at home?", "any")).toEqual([]);
    expect(await search("quantum chromodynamics", "any")).toEqual([]);
  });

  it("does not cite a passage that shares one stray word with a longer question", async () => {
    expect(await search("Which loop do Olympic runners run on the outdoor track?", "any")).toEqual([]);
  });

  it("returns nothing for a query of only stop words", async () => {
    expect(await search("the and of", "any")).toEqual([]);
  });

  it("keeps every result a match-all search finds", async () => {
    const all = await search("loop invariant", "all");
    const any = await search("loop invariant", "any");
    expect(all.length).toBeGreaterThan(0);
    expect(any.map((r: { chunk_id: string }) => r.chunk_id)).toEqual(
      expect.arrayContaining(all.map((r: { chunk_id: string }) => r.chunk_id)),
    );
  });
});
