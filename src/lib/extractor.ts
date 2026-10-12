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
 * - application/pdf: extract text per page via pdf-parse v1
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

// The slice of pdf-parse v1 (and its bundled pdf.js) that this module uses
interface PdfTextItem {
  str: string;
  transform: number[];
}
interface PdfPage {
  pageNumber: number;
  getTextContent(): Promise<{ items: PdfTextItem[] }>;
}
type PdfParse = (
  data: Uint8Array,
  options?: { pagerender?: (page: PdfPage) => Promise<string> },
) => Promise<{ text: string; numpages: number }>;

/** A page's text, one line per baseline (pdf-parse's default rendering). */
async function renderPageText(page: PdfPage): Promise<string> {
  const { items } = await page.getTextContent();
  let text = "";
  let lastY: number | undefined;
  for (const item of items) {
    const y = item.transform[5];
    text += lastY === undefined || y === lastY ? item.str : "\n" + item.str;
    lastY = y;
  }
  return text;
}

async function extractPdf(filePath: string): Promise<ExtractionResult> {
  // Load the library file, not the package entry: pdf-parse's index.js runs a
  // debug routine that reads a test PDF from disk whenever module.parent is
  // unset, which happens once a bundler wraps it. next.config.js also keeps
  // pdf-parse out of the server bundle (serverExternalPackages), since it
  // picks its pdf.js build with a dynamic require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as PdfParse;
  const buffer = await readFile(filePath);

  // Pass a plain Uint8Array, not the Buffer. pdf.js copies its input with
  // `new input.constructor(input)`; for a Buffer under 4 KB that copy lands in
  // Node's shared buffer pool at a non-zero offset, which pdf.js ignores, so
  // small PDFs failed with "bad XRef entry".
  const pageTexts = new Map<number, string>();
  const result = await pdfParse(new Uint8Array(buffer), {
    pagerender: async (page) => {
      const text = await renderPageText(page);
      pageTexts.set(page.pageNumber, text);
      return text;
    },
  });

  const fullText = normalizeWhitespace(result.text);
  const pages: PageText[] = [...pageTexts.entries()]
    .sort(([a], [b]) => a - b)
    .map(([pageNumber, text]) => ({ pageNumber, text: normalizeWhitespace(text) }))
    .filter((page) => page.text.length > 0);

  return pages.length > 0 ? { pages, fullText } : { fullText };
}

/**
 * Normalize whitespace: collapse runs of whitespace to single space,
 * preserve paragraph breaks (double newline).
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
