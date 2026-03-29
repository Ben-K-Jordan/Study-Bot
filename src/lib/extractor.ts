import { readFile } from "fs/promises";

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface ExtractionResult {
  pages?: PageText[];
  fullText: string;
}

/**
 * Extract text from a file based on its MIME type.
 * - text/* and .md: read as UTF-8
 * - application/pdf: extract text via pdf-parse v1
 */
export async function extractDocumentText(
  filePath: string,
  mimeType: string
): Promise<ExtractionResult> {
  if (mimeType === "application/pdf") {
    return extractPdf(filePath);
  }
  // Text-based files
  const raw = await readFile(filePath, "utf-8");
  return { fullText: normalizeWhitespace(raw) };
}

async function extractPdf(filePath: string): Promise<ExtractionResult> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
  const buffer = await readFile(filePath);
  const result = await pdfParse(buffer);

  // pdf-parse v1 returns full text concatenated; no per-page breakdown.
  // We approximate page boundaries by splitting on form feeds if present.
  const fullText = normalizeWhitespace(result.text);
  const pageTexts = result.text.split("\f").filter((p) => p.trim().length > 0);

  if (pageTexts.length > 1) {
    const pages: PageText[] = pageTexts.map((text, i) => ({
      pageNumber: i + 1,
      text: normalizeWhitespace(text),
    }));
    return { pages, fullText };
  }

  return { fullText };
}

/**
 * Normalize whitespace: collapse runs of whitespace to single space,
 * preserve paragraph breaks (double newline).
 */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
