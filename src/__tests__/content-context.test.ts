import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The passages a session's questions are written from. Full-text search ANDs
 * every word of its query, so searching all objective titles at once found
 * almost nothing and sessions fell back to template questions. Each
 * objective is searched on its own now. Search and Prisma are mocked: a
 * chunk "matches" when it contains every word of the query.
 */
const search = vi.hoisted(() => ({ searchChunks: vi.fn() }));
vi.mock("@/lib/search", () => search);
const db = vi.hoisted(() => ({ contentChunk: { count: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { fallbackWords, getContentContextForSession, mergeRoundRobin } from "@/services/content-plan";
import type { SearchParams, SearchResult } from "@/lib/search";

interface Chunk {
  id: string;
  exam?: string;
  text: string;
}

const CHUNKS: Chunk[] = [
  { id: "rec-1", exam: "Prelim 1", text: "recursion base case and recursive call" },
  { id: "rec-2", exam: "Prelim 1", text: "recursion on linked structures" },
  { id: "stack-1", exam: "Prelim 1", text: "stacks push pop last in first out" },
  { id: "stack-2", text: "stacks hold the call frames of a recursion" },
  { id: "graph-1", text: "graphs breadth first search uses a queue" },
  { id: "sort-1", exam: "Final", text: "merge sort splits the array" },
];

function result(chunk: Chunk, rank = 1): SearchResult {
  return { chunk_id: chunk.id, doc_id: "doc", doc_title: "Lecture", page_number: 1, rank_score: rank, snippet: chunk.text };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.contentChunk.count.mockResolvedValue(CHUNKS.length);
  search.searchChunks.mockImplementation(async (params: SearchParams) => {
    const words = params.q.toLowerCase().split(/\s+/).filter(Boolean);
    return CHUNKS.filter((c) => !params.examName || c.exam === params.examName)
      .filter((c) => words.every((w) => c.text.includes(w)))
      .slice(0, params.topK ?? 5)
      .map((c) => result(c));
  });
});

const queries = () => search.searchChunks.mock.calls.map(([p]) => (p as SearchParams).q);

describe("getContentContextForSession", () => {
  it("searches each objective on its own and takes from each in turn", async () => {
    const context = await getContentContextForSession("u1", "CS 2110", "INTERLEAVED_PRACTICE", ["Recursion", "Stacks"], 4);

    // Never one query holding every title, and no mode words
    expect(queries()).toEqual(["Recursion", "Stacks"]);
    expect(context.snippets.map((s) => s.chunk_id)).toEqual(["rec-1", "stack-1", "rec-2", "stack-2"]);
    expect(context.totalChunks).toBe(CHUNKS.length);
  });

  it("asks each objective for at least 2 chunks, and caps the total at topK", async () => {
    await getContentContextForSession("u1", "CS 2110", "EXAM_SIM", ["Recursion", "Stacks", "Graphs", "Sorting"], 5);
    for (const [params] of search.searchChunks.mock.calls) expect((params as SearchParams).topK).toBe(2);

    const context = await getContentContextForSession("u1", "CS 2110", "EXAM_SIM", ["Recursion", "Stacks"], 3);
    expect(context.snippets).toHaveLength(3);
  });

  it("finds an objective through its main words when the whole title matches nothing", async () => {
    const context = await getContentContextForSession("u1", "CS 2110", "RETRIEVAL", ["Understanding graphs and queues"], 5);

    expect(queries()[0]).toBe("Understanding graphs and queues");
    // Then its main words one at a time; "Understanding" and "and" are never searched
    expect(queries().slice(1).sort()).toEqual(["graphs", "queues"]);
    expect(context.snippets.map((s) => s.chunk_id)).toEqual(["graph-1"]);
  });

  it("prefers the exam's files and uses the whole course when they have nothing on an objective", async () => {
    const context = await getContentContextForSession("u1", "CS 2110", "RETRIEVAL", ["Stacks", "Graphs"], 6, {
      examName: "Prelim 1",
    });

    const ids = context.snippets.map((s) => s.chunk_id);
    // Stacks: Prelim 1 has a chunk, so the untagged one is not used
    expect(ids).toContain("stack-1");
    expect(ids).not.toContain("stack-2");
    // Graphs: nothing for Prelim 1, so the course-wide chunk stands in
    expect(ids).toContain("graph-1");
  });

  it("returns no passages and runs no search without objectives", async () => {
    const context = await getContentContextForSession("u1", "CS 2110", "RETRIEVAL", ["  ", ""], 5);
    expect(context.snippets).toEqual([]);
    expect(search.searchChunks).not.toHaveBeenCalled();
  });
});

describe("mergeRoundRobin", () => {
  it("skips a chunk two objectives share", () => {
    const [a, b, c] = CHUNKS;
    expect(mergeRoundRobin([[result(a), result(b)], [result(a), result(c)]], 5).map((r) => r.chunk_id)).toEqual([
      "rec-1",
      "rec-2",
      "stack-1",
    ]);
  });
});

describe("fallbackWords", () => {
  it("keeps the 3 longest distinct words and drops filler", () => {
    expect(fallbackWords("Explain the call stack and the call frames of recursion")).toEqual([
      "recursion",
      "frames",
      "stack",
    ]);
  });
});
