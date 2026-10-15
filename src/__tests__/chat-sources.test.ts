/**
 * Numbered chat sources: inline [n] must point at the source shown as n.
 */
import { describe, it, expect } from "vitest";
import {
  inlineMarkerNumbers,
  isLegacyNoMatch,
  normalizeAnswer,
  noticeText,
  storedNotice,
  toSources,
  verifiedQuote,
  type RetrievedExcerpt,
} from "@/app/api/chat/_lib/sources";

const retrieved: RetrievedExcerpt[] = [
  { chunk_id: "a", doc_title: "Lecture 14", page_number: 3, snippet: "Compare the columns left to right. The first difference decides." },
  { chunk_id: "b", doc_title: "Lecture 18", page_number: null, snippet: "If you use w descriptors and leave out sizes, the browser assumes 100vw." },
  { chunk_id: "c", doc_title: "Lecture 16", page_number: 7, snippet: "Grid places items on explicit tracks." },
];

describe("normalizeAnswer", () => {
  it("renumbers by first mention so [n] matches sources[n - 1]", () => {
    const { markdown, citations } = normalizeAnswer(
      "Sizes matters [2]. Columns decide [1]. Again sizes [2].",
      [
        { chunk_id: "a", reason: "r", quote_snippet: "Compare the columns left to right" },
        { chunk_id: "b", reason: "r", quote_snippet: "leave out sizes" },
      ],
      retrieved,
    );
    expect(markdown).toBe("Sizes matters [1]. Columns decide [2]. Again sizes [1].");
    expect(citations.map((c) => c.chunk_id)).toEqual(["b", "a"]);
    expect(citations[0].doc_title).toBe("Lecture 18");
    expect(citations[1].page_number).toBe(3);
  });

  it("reads markers in the model's own citation order when excerpt numbers don't fit", () => {
    // The model cited c then a, and wrote [1] for c and [2] for a.
    const { markdown, citations } = normalizeAnswer(
      "Grid uses tracks [1]. Columns decide [2].",
      [
        { chunk_id: "c", quote_snippet: "Grid places items" },
        { chunk_id: "a", quote_snippet: "Compare the columns" },
      ],
      retrieved,
    );
    expect(citations.map((c) => c.chunk_id)).toEqual(["c", "a"]);
    expect(markdown).toBe("Grid uses tracks [1]. Columns decide [2].");
  });

  it("drops citations to chunks that weren't retrieved and markers that point nowhere", () => {
    const { markdown, citations } = normalizeAnswer(
      "Answer [9] text.",
      [{ chunk_id: "mock_chunk_1", quote_snippet: "x" }],
      retrieved,
    );
    expect(citations).toEqual([]);
    expect(markdown).toBe("Answer text.");
  });

  it("lists cited excerpts the text never mentions after the mentioned ones", () => {
    const { citations } = normalizeAnswer("Only one [3].", [{ chunk_id: "a" }, { chunk_id: "c" }], retrieved);
    expect(citations.map((c) => c.chunk_id)).toEqual(["c", "a"]);
  });

  it("leaves markers inside code alone", () => {
    const md = "Use `arr[2]` here [2].\n\n```\nx = y[1]\n```";
    expect(inlineMarkerNumbers(md)).toEqual([2]);
    const { markdown } = normalizeAnswer(md, [{ chunk_id: "b" }], retrieved);
    expect(markdown).toBe("Use `arr[2]` here [1].\n\n```\nx = y[1]\n```");
  });

  it("splits grouped markers", () => {
    const { markdown } = normalizeAnswer("Both [1, 3].", [{ chunk_id: "a" }, { chunk_id: "c" }], retrieved);
    expect(markdown).toBe("Both [1][2].");
  });

  it("does not treat Markdown links as markers", () => {
    expect(inlineMarkerNumbers("See [1](https://example.com) and [2].")).toEqual([2]);
  });
});

describe("verifiedQuote", () => {
  it("keeps a quote that appears in the excerpt", () => {
    expect(verifiedQuote("Compare the columns left to right", retrieved[0].snippet)).toBe(
      "Compare the columns left to right",
    );
  });

  it("replaces an invented quote with the excerpt's opening, without search highlights", () => {
    expect(verifiedQuote("Something the file never says", "<<Grid>> places items on tracks.")).toBe(
      "Grid places items on tracks.",
    );
  });
});

describe("stored messages", () => {
  it("reads notices and legacy no-match answers", () => {
    expect(storedNotice({ notice: "processing" })).toBe("processing");
    expect(storedNotice([{ chunk_id: "a" }])).toBeNull();
    expect(isLegacyNoMatch("I couldn't find any relevant materials in your course documents to answer this question.")).toBe(true);
    expect(noticeText("no_match", "INFO 1300")).toBe(
      "Your INFO 1300 materials don't cover this. Upload the file that does, or ask it a different way.",
    );
  });

  it("numbers sources with titles and pages from the chunk lookup", () => {
    const sources = toSources(
      [
        { chunk_id: "a", quote_snippet: "q1" },
        { chunk_id: "gone", quote_snippet: "q2", doc_title: "Old file", page_number: 2 },
      ],
      new Map([["a", { title: "Lecture 14", page: 3 }]]),
    );
    expect(sources).toEqual([
      { n: 1, chunk_id: "a", title: "Lecture 14", page: 3, quote: "q1", missing: false },
      { n: 2, chunk_id: "gone", title: "Old file", page: 2, quote: "q2", missing: true },
    ]);
  });
});
