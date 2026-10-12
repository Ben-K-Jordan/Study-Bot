/**
 * Unit tests for document text extraction, including a real PDF parse.
 *
 * The PDF fixture is generated in memory (one page per string, Helvetica
 * text, a correct xref table) so the repo carries no binary test files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { extractDocumentText } from "@/lib/extractor";

/** Build a minimal valid PDF with one line of text per page. */
function buildPdf(pageTexts: string[]): Buffer {
  const objects: string[] = [];
  const pageCount = pageTexts.length;
  // 1: catalog, 2: page tree, 3: font, then a (page, content) pair per page
  const pageIds = pageTexts.map((_, i) => 4 + i * 2);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  for (const [i, text] of pageTexts.entries()) {
    const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i] + 1} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

describe("extractDocumentText", () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "studybot-extractor-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("extracts the text of a small PDF page by page", async () => {
    // Under 4 KB, which used to trip pdf.js when handed a pooled Buffer
    const file = join(dir, "notes.pdf");
    await writeFile(file, buildPdf(["Spacing beats cramming", "Retrieval practice works"]));

    const result = await extractDocumentText(file, "application/pdf");

    expect(result.fullText).toContain("Spacing beats cramming");
    expect(result.fullText).toContain("Retrieval practice works");
    expect(result.pages).toEqual([
      { pageNumber: 1, text: "Spacing beats cramming" },
      { pageNumber: 2, text: "Retrieval practice works" },
    ]);
  });

  it("keeps real page numbers when a page has no text", async () => {
    const file = join(dir, "gap.pdf");
    await writeFile(file, buildPdf(["First page", "", "Third page"]));

    const result = await extractDocumentText(file, "application/pdf");

    expect(result.pages).toEqual([
      { pageNumber: 1, text: "First page" },
      { pageNumber: 3, text: "Third page" },
    ]);
  });

  it("reads text files as UTF-8 and normalizes whitespace", async () => {
    const file = join(dir, "notes.md");
    await writeFile(file, "# Title\r\n\r\n\r\n\r\nSome   text\twith  gaps\n", "utf-8");

    const result = await extractDocumentText(file, "text/markdown");

    expect(result.fullText).toBe("# Title\n\nSome text with gaps");
    expect(result.pages).toBeUndefined();
  });
});
