/**
 * Unit tests for Reciprocal Rank Fusion (RRF) determinism.
 */
import { describe, it, expect } from "vitest";
import { reciprocalRankFusion, type SearchResult } from "@/lib/search";

function makeResult(chunkId: string, score: number): SearchResult {
  return {
    chunk_id: chunkId,
    doc_id: "doc1",
    doc_title: "Test",
    page_number: null,
    rank_score: score,
    snippet: `Snippet for ${chunkId}`,
  };
}

describe("reciprocalRankFusion", () => {
  it("returns empty for empty inputs", () => {
    expect(reciprocalRankFusion([], [])).toEqual([]);
  });

  it("returns FTS-only results when vector is empty", () => {
    const fts = [makeResult("a", 0.9), makeResult("b", 0.7)];
    const result = reciprocalRankFusion(fts, []);
    expect(result).toHaveLength(2);
    expect(result[0].chunk_id).toBe("a");
    expect(result[1].chunk_id).toBe("b");
  });

  it("boosts chunks that appear in both lists", () => {
    const fts = [makeResult("a", 0.9), makeResult("b", 0.7), makeResult("c", 0.5)];
    const vec = [makeResult("c", 0.95), makeResult("a", 0.8), makeResult("d", 0.6)];

    const result = reciprocalRankFusion(fts, vec, 60);

    // "a" appears in both lists (rank 1 in FTS, rank 2 in vec) → highest score
    expect(result[0].chunk_id).toBe("a");
    // "c" also appears in both (rank 3 in FTS, rank 1 in vec)
    expect(result[1].chunk_id).toBe("c");
  });

  it("is deterministic — same inputs always produce same output", () => {
    const fts = [makeResult("x", 0.5), makeResult("y", 0.3)];
    const vec = [makeResult("y", 0.8), makeResult("z", 0.6)];

    const r1 = reciprocalRankFusion(fts, vec, 60);
    const r2 = reciprocalRankFusion(fts, vec, 60);

    expect(r1.map((r) => r.chunk_id)).toEqual(r2.map((r) => r.chunk_id));
    expect(r1.map((r) => r.rank_score)).toEqual(r2.map((r) => r.rank_score));
  });

  it("uses the specified k parameter", () => {
    const fts = [makeResult("a", 0.9)];
    const vec = [makeResult("a", 0.8)];

    // With k=60: score = 1/(60+1) + 1/(60+1) = 2/61
    const r60 = reciprocalRankFusion(fts, vec, 60);
    expect(r60[0].rank_score).toBeCloseTo(2 / 61, 10);

    // With k=1: score = 1/(1+1) + 1/(1+1) = 1
    const r1 = reciprocalRankFusion(fts, vec, 1);
    expect(r1[0].rank_score).toBeCloseTo(1.0, 10);
  });

  it("preserves FTS snippet for items in both lists", () => {
    const fts = [{ ...makeResult("a", 0.9), snippet: "<<highlighted>> FTS" }];
    const vec = [{ ...makeResult("a", 0.8), snippet: "plain vector snippet" }];

    const result = reciprocalRankFusion(fts, vec);
    // FTS result was seen first, so its snippet should be kept
    expect(result[0].snippet).toContain("highlighted");
  });
});
