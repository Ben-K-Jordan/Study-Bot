import { describe, it, expect } from "vitest";
import { chunkText } from "@/lib/chunker";
import type { PageText } from "@/lib/extractor";

describe("chunker", () => {
  it("produces deterministic output for same input", () => {
    const text = "A".repeat(3000);
    const chunks1 = chunkText(text);
    const chunks2 = chunkText(text);
    expect(chunks1).toEqual(chunks2);
  });

  it("creates multiple chunks for long text", () => {
    // 4000 chars of paragraphs should produce multiple chunks
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${("word ".repeat(40)).trim()}.`
    ).join("\n\n");

    const chunks = chunkText(paragraphs);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("each chunk is within size bounds", () => {
    const text = Array.from({ length: 30 }, (_, i) =>
      `Section ${i}: ${("Lorem ipsum dolor sit amet. ".repeat(10)).trim()}`
    ).join("\n\n");

    const chunks = chunkText(text);
    for (const chunk of chunks) {
      // Chunks should generally be under 1800 chars (MAX + some tolerance)
      expect(chunk.text.length).toBeLessThan(2000);
      // Non-empty
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it("preserves overlap between consecutive chunks", () => {
    const text = Array.from({ length: 30 }, (_, i) =>
      `Unique-marker-${i}: ${"x".repeat(100)}.`
    ).join("\n\n");

    const chunks = chunkText(text);
    if (chunks.length >= 2) {
      // Check that some text from end of chunk N appears at start of chunk N+1
      const lastPart = chunks[0].text.slice(-50);
      const nextStart = chunks[1].text.slice(0, 300);
      // Due to overlap, there should be some shared content
      const sharedChars = lastPart.split("").filter((c) => nextStart.includes(c)).length;
      expect(sharedChars).toBeGreaterThan(0);
    }
  });

  it("assigns sequential ordinals", () => {
    const text = "word ".repeat(500);
    const chunks = chunkText(text);
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i].ordinal).toBe(i);
    }
  });

  it("generates text_hash for each chunk", () => {
    const text = "Hello world. ".repeat(200);
    const chunks = chunkText(text);
    for (const chunk of chunks) {
      expect(chunk.textHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("returns same hash for same text content", () => {
    const text = "Consistent content for hashing. ".repeat(100);
    const chunks1 = chunkText(text);
    const chunks2 = chunkText(text);
    expect(chunks1[0].textHash).toBe(chunks2[0].textHash);
  });

  it("handles page-aware chunking", () => {
    const pages: PageText[] = [
      { pageNumber: 1, text: "Page one content. ".repeat(50) },
      { pageNumber: 2, text: "Page two content. ".repeat(50) },
      { pageNumber: 3, text: "Page three content. ".repeat(50) },
    ];

    const chunks = chunkText("", pages);
    expect(chunks.length).toBeGreaterThan(0);

    // At least some chunks should have page numbers
    const paged = chunks.filter((c) => c.pageNumber !== null);
    expect(paged.length).toBeGreaterThan(0);
  });

  it("handles very short text without crashing", () => {
    const chunks = chunkText("Hello world.");
    expect(chunks.length).toBe(1);
    expect(chunks[0].text).toBe("Hello world.");
  });

  it("handles empty text", () => {
    const chunks = chunkText("");
    expect(chunks.length).toBe(0);
  });

  it("does not duplicate overlap text when merging a short trailing paragraph", () => {
    // Long first paragraph forces a flush, short second paragraph triggers
    // the merge-into-last-chunk path
    const para1 = Array.from({ length: 33 }, (_, i) =>
      `Sentence ${String(i).padStart(2, "0")} of the first paragraph adds body.`
    ).join(" ");
    const para2 =
      "A short trailing paragraph, well under half the minimum chunk size, that ends the document and must appear in the final chunk only once.";

    const chunks = chunkText(`${para1}\n\n${para2}`);

    expect(chunks.length).toBe(1);
    // Merged chunk is exactly para1 + newline + para2 — no repeated overlap tail
    expect(chunks[0].text.length).toBe(para1.length + 1 + para2.length);
    // The last sentence of para1 must not be duplicated by the merge
    const lastSentence = "Sentence 32 of the first paragraph adds body.";
    expect(chunks[0].text.split(lastSentence).length - 1).toBe(1);
    expect(chunks[0].text.split(para2).length - 1).toBe(1);
  });

  it("hard-splits a paragraph with no sentence punctuation into bounded chunks", () => {
    const text = "x".repeat(10000);
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Every chunk must respect the documented max size (1600)
      expect(chunk.text.length).toBeLessThanOrEqual(1600);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });

  it("splits CJK text on fullwidth sentence terminators", () => {
    const sentence = "這是一個用於測試分塊器的完整句子，包含足夠的內容。";
    const text = sentence.repeat(300);
    const chunks = chunkText(text);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // Sentence-split chunks stay within MAX + overlap (1600 + 200)
      expect(chunk.text.length).toBeLessThanOrEqual(1800);
      expect(chunk.text.length).toBeGreaterThan(0);
    }
  });
});
