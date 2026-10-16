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
 * How much of one file is read. A small PDF can still hold thousands of
 * pages that share one content stream, and pdf-parse reads every page in
 * the server's own process, so reading stops at these limits and the file
 * is refused (never cut short without saying so).
 */
export interface ExtractionLimits {
  /** Pages read from a PDF. */
  maxPages: number;
  /** Characters of text, about 600 dense pages. */
  maxChars: number;
  /** Time spent reading a PDF's pages, in ms. */
  maxMs: number;
}

export const EXTRACTION_LIMITS: ExtractionLimits = {
  maxPages: 500,
  maxChars: 2_000_000,
  maxMs: 30_000,
};

/** The file is over a reading limit. Its message is shown to the student. */
export class DocumentTooLongError extends Error {
  readonly code = "too_long";

  constructor() {
    super("This file is too long to read. Split it into smaller files.");
    this.name = "DocumentTooLongError";
  }
}

/**
 * Extract text from a file based on its MIME type.
 * - text/* and .md: read as UTF-8
 * - application/pdf: extract text per page via pdf-parse v1
 * Throws DocumentTooLongError past `limits`.
 */
export async function extractDocumentText(
  filePath: string,
  mimeType: string,
  limits: ExtractionLimits = EXTRACTION_LIMITS,
): Promise<ExtractionResult> {
  if (mimeType === "application/pdf") {
    return extractPdf(filePath, limits);
  }
  // Text-based files
  const raw = await readFile(filePath, "utf-8");
  const fullText = normalizeWhitespace(raw);
  if (fullText.length > limits.maxChars) throw new DocumentTooLongError();
  return { fullText };
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
  options?: { pagerender?: (page: PdfPage) => Promise<string>; max?: number },
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

async function extractPdf(filePath: string, limits: ExtractionLimits): Promise<ExtractionResult> {
  // Load the library file, not the package entry: pdf-parse's index.js runs a
  // debug routine that reads a test PDF from disk whenever module.parent is
  // unset, which happens once a bundler wraps it. next.config.js also keeps
  // pdf-parse out of the server bundle (serverExternalPackages), since it
  // picks its pdf.js build with a dynamic require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as PdfParse;
  const buffer = await readFile(filePath);

  const pageTexts = new Map<number, string>();
  const started = Date.now();
  let chars = 0;
  let overBudget = false;
  // Pass a plain Uint8Array, not the Buffer. pdf.js copies its input with
  // `new input.constructor(input)`; for a Buffer under 4 KB that copy lands in
  // Node's shared buffer pool at a non-zero offset, which pdf.js ignores, so
  // small PDFs failed with "bad XRef entry".
  const result = await pdfParse(new Uint8Array(buffer), {
    max: limits.maxPages,
    // pdf-parse catches anything thrown here and records the page as blank,
    // so a spent budget can't stop the loop by throwing. It returns "" for
    // every remaining page instead, without reading its text (the expensive
    // part), and the file is refused once the loop ends.
    pagerender: async (page) => {
      if (overBudget) return "";
      if (Date.now() - started > limits.maxMs) {
        overBudget = true;
        return "";
      }
      const text = await renderPageText(page);
      chars += text.length;
      if (chars > limits.maxChars || Date.now() - started > limits.maxMs) {
        overBudget = true;
        return "";
      }
      pageTexts.set(page.pageNumber, text);
      return text;
    },
  });

  // Past the page limit the rest of the file was never read
  if (overBudget || result.numpages > limits.maxPages) throw new DocumentTooLongError();

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
