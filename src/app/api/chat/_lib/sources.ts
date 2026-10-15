/**
 * Numbered sources for chat answers.
 *
 * The answer prompt lists the retrieved excerpts as [1]..[k] and asks the
 * model to cite chunk ids. Models write inline markers like "[2]" against
 * that excerpt numbering (sometimes against their own citation list), and
 * their citation list comes in any order. normalizeAnswer() turns both into
 * one convention that every stored message follows, old ones included:
 * inline [n] refers to citations[n - 1], numbered in order of first mention.
 */

/** A citation as stored on an assistant ChatMessage (JSON). Older rows lack the title and page. */
export interface StoredCitation {
  chunk_id: string;
  reason?: string;
  quote_snippet: string;
  doc_title?: string | null;
  page_number?: number | null;
}

/** An assistant message with no AI text: the honesty line when retrieval finds nothing. */
export interface StoredNotice {
  notice: "no_match" | "processing" | "no_materials";
}

/** One numbered source as the client renders it. */
export interface ChatSource {
  n: number;
  chunk_id: string;
  /** File title, or null when the file was deleted. */
  title: string | null;
  page: number | null;
  quote: string;
  /** The file was deleted from the materials after the answer. */
  missing: boolean;
}

export interface RetrievedExcerpt {
  chunk_id: string;
  doc_title: string;
  page_number: number | null;
  snippet: string;
}

export interface ModelCitation {
  chunk_id: string;
  reason?: string;
  quote_snippet?: string;
}

const MARKER = /\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:])/g;
const QUOTE_MAX = 280;

/** Splits markdown into prose and code (fenced blocks and inline spans), so markers in code stay put. */
function splitCode(markdown: string): { text: string; code: boolean }[] {
  const parts: { text: string; code: boolean }[] = [];
  const pattern = /(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`)/g;
  let last = 0;
  for (const match of markdown.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push({ text: markdown.slice(last, index), code: false });
    parts.push({ text: match[0], code: true });
    last = index + match[0].length;
  }
  if (last < markdown.length) parts.push({ text: markdown.slice(last), code: false });
  return parts;
}

/** Numbers in inline markers, in order of appearance, outside code. */
export function inlineMarkerNumbers(markdown: string): number[] {
  const numbers: number[] = [];
  for (const part of splitCode(markdown)) {
    if (part.code) continue;
    for (const match of part.text.matchAll(MARKER)) {
      for (const n of match[1].split(",")) numbers.push(Number(n.trim()));
    }
  }
  return numbers;
}

function rewriteMarkers(markdown: string, map: (n: number) => number | null): string {
  return splitCode(markdown)
    .map((part) =>
      part.code
        ? part.text
        : part.text.replace(/(\s?)\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\](?![(:])/g, (_whole, space: string, list: string) => {
            const mapped = list
              .split(",")
              .map((n) => map(Number(n.trim())))
              .filter((n): n is number => n !== null);
            const unique = [...new Set(mapped)];
            return unique.length > 0 ? `${space}${unique.map((n) => `[${n}]`).join("")}` : "";
          }),
    )
    .join("");
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * The quote shown under a source. The model's quote is kept only when it
 * really appears in the excerpt; otherwise the excerpt's opening is used,
 * so a source never shows words the file doesn't contain.
 */
export function verifiedQuote(modelQuote: string | undefined, excerpt: string): string {
  const source = squash(excerpt.replace(/<<|>>/g, ""));
  const quote = modelQuote ? squash(modelQuote).replace(/^["“]|["”]$/g, "").replace(/\.{3}$|…$/, "") : "";
  if (quote.length >= 12 && source.toLowerCase().includes(quote.toLowerCase())) {
    return quote.length > QUOTE_MAX ? `${quote.slice(0, QUOTE_MAX).trimEnd()}…` : quote;
  }
  if (source.length <= QUOTE_MAX) return source;
  const cut = source.slice(0, QUOTE_MAX);
  const sentenceEnd = cut.lastIndexOf(". ");
  return sentenceEnd > 80 ? cut.slice(0, sentenceEnd + 1) : `${cut.trimEnd()}…`;
}

/**
 * Renumbers an answer's sources. Returns the markdown with inline markers
 * pointing at the returned citations (1-based, order of first mention, then
 * cited-but-unmentioned excerpts), and drops markers and citations that
 * match no retrieved excerpt.
 */
export function normalizeAnswer(
  markdown: string,
  modelCitations: ModelCitation[] | undefined,
  retrieved: RetrievedExcerpt[],
): { markdown: string; citations: StoredCitation[] } {
  const indexById = new Map(retrieved.map((r, i) => [r.chunk_id, i + 1]));
  const cited = (modelCitations ?? []).filter(
    (c): c is ModelCitation => Boolean(c) && typeof c.chunk_id === "string" && indexById.has(c.chunk_id),
  );
  const citedIndexes = cited.map((c) => indexById.get(c.chunk_id)!);
  const citedSet = new Set(citedIndexes);
  const markers = inlineMarkerNumbers(markdown);

  // Which numbering did the model use for inline markers? Excerpt numbers
  // ([1]..[k] in the prompt) unless they point outside the cited excerpts
  // while the model's own citation order explains every marker.
  const inExcerptRange = (n: number) => n >= 1 && n <= retrieved.length;
  const excerptFits = markers.every((n) => inExcerptRange(n) && (citedSet.size === 0 || citedSet.has(n)));
  const ownOrderFits =
    !excerptFits && cited.length > 0 && markers.length > 0 && markers.every((n) => n >= 1 && n <= cited.length);
  const toExcerpt = (n: number): number | null => {
    if (ownOrderFits) return n >= 1 && n <= cited.length ? citedIndexes[n - 1] : null;
    return inExcerptRange(n) ? n : null;
  };

  const order: number[] = [];
  for (const n of markers) {
    const excerpt = toExcerpt(n);
    if (excerpt !== null && !order.includes(excerpt)) order.push(excerpt);
  }
  for (const excerpt of citedIndexes) if (!order.includes(excerpt)) order.push(excerpt);

  const displayNumber = new Map(order.map((excerpt, i) => [excerpt, i + 1]));
  const rewritten = rewriteMarkers(markdown, (n) => {
    const excerpt = toExcerpt(n);
    return excerpt === null ? null : (displayNumber.get(excerpt) ?? null);
  });

  const citations = order.map((excerpt) => {
    const r = retrieved[excerpt - 1];
    const model = cited.find((c) => c.chunk_id === r.chunk_id);
    return {
      chunk_id: r.chunk_id,
      reason: model?.reason,
      quote_snippet: verifiedQuote(model?.quote_snippet, r.snippet),
      doc_title: r.doc_title,
      page_number: r.page_number,
    };
  });

  return { markdown: rewritten, citations };
}

function isStoredCitation(value: unknown): value is StoredCitation {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as StoredCitation).chunk_id === "string"
  );
}

/** Stored citations JSON as an array (anything else is empty). */
export function storedCitations(value: unknown): StoredCitation[] {
  return Array.isArray(value) ? value.filter(isStoredCitation) : [];
}

/** The notice kind when the stored JSON marks a no-AI message. */
export function storedNotice(value: unknown): StoredNotice["notice"] | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const notice = (value as Partial<StoredNotice>).notice;
  return notice === "no_match" || notice === "processing" || notice === "no_materials" ? notice : null;
}

/** The sentence for each notice, about the course in `courseName`. */
export function noticeText(notice: StoredNotice["notice"], courseName: string): string {
  switch (notice) {
    case "processing":
      return `Your ${courseName} materials are still processing. Ask again when they're ready.`;
    case "no_materials":
      return `You haven't uploaded ${courseName} materials yet. Upload them, then ask again.`;
    default:
      return `Your ${courseName} materials don't cover this. Upload the file that does, or ask it a different way.`;
  }
}

/** Answers older builds stored when nothing matched, written in the first person. */
export function isLegacyNoMatch(content: string): boolean {
  return content.startsWith("I couldn't find any relevant materials in your course documents");
}

/** Builds the numbered sources for stored citations, with file titles and pages looked up by chunk. */
export function toSources(
  citations: StoredCitation[],
  chunks: Map<string, { title: string; page: number | null }>,
): ChatSource[] {
  return citations.map((c, i) => {
    const chunk = chunks.get(c.chunk_id);
    return {
      n: i + 1,
      chunk_id: c.chunk_id,
      title: chunk?.title ?? c.doc_title ?? null,
      page: chunk ? chunk.page : (c.page_number ?? null),
      quote: c.quote_snippet ?? "",
      missing: !chunk,
    };
  });
}
