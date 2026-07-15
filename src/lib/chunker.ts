import { sha256 } from "./storage";
import type { PageText } from "./extractor";

export interface Chunk {
  ordinal: number;
  pageNumber: number | null;
  text: string;
  textHash: string;
}

const MIN_CHUNK_SIZE = 800;
const MAX_CHUNK_SIZE = 1600;
const OVERLAP_SIZE = 200;

/**
 * Split text into overlapping chunks of ~800–1600 characters.
 * Prefers splitting on paragraph boundaries, falls back to sentence boundaries.
 * For page-aware PDFs, tracks which page each chunk belongs to.
 */
export function chunkText(
  fullText: string,
  pages?: PageText[]
): Chunk[] {
  if (pages && pages.length > 0) {
    return chunkPages(pages);
  }
  return chunkPlainText(fullText);
}

function chunkPlainText(text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const paragraphs = splitIntoParagraphs(text);
  let buffer = "";
  let bufferOverlap = "";
  let ordinal = 0;

  for (const para of paragraphs) {
    if (buffer.length + para.length + 1 > MAX_CHUNK_SIZE && buffer.length >= MIN_CHUNK_SIZE) {
      chunks.push(makeChunk(buffer.trim(), ordinal++, null));
      // Overlap: keep tail of previous chunk
      bufferOverlap = getOverlap(buffer);
      buffer = bufferOverlap + para + "\n";
    } else {
      buffer += para + "\n";
    }
  }

  if (buffer.trim().length > 0) {
    // If last buffer is too small and we have previous chunks, merge into last chunk
    if (chunks.length > 0 && buffer.trim().length < MIN_CHUNK_SIZE / 2) {
      // Strip the overlap prefix first — it already exists at the end of the
      // last chunk, so appending it again would duplicate that text
      const remainder = buffer.startsWith(bufferOverlap)
        ? buffer.slice(bufferOverlap.length)
        : buffer;
      if (remainder.trim().length > 0) {
        const last = chunks[chunks.length - 1];
        chunks[chunks.length - 1] = makeChunk(last.text + "\n" + remainder.trim(), last.ordinal, null);
      }
    } else {
      chunks.push(makeChunk(buffer.trim(), ordinal++, null));
    }
  }

  // Re-index ordinals to be sequential
  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

function chunkPages(pages: PageText[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferPage = pages[0]?.pageNumber ?? 1;
  let ordinal = 0;

  for (const page of pages) {
    const paragraphs = splitIntoParagraphs(page.text);

    for (const para of paragraphs) {
      if (buffer.length + para.length + 1 > MAX_CHUNK_SIZE && buffer.length >= MIN_CHUNK_SIZE) {
        chunks.push(makeChunk(buffer.trim(), ordinal++, bufferPage));
        buffer = getOverlap(buffer) + para + "\n";
        bufferPage = page.pageNumber;
      } else {
        if (buffer.length === 0) {
          bufferPage = page.pageNumber;
        }
        buffer += para + "\n";
      }
    }
  }

  if (buffer.trim().length > 0) {
    chunks.push(makeChunk(buffer.trim(), ordinal++, bufferPage));
  }

  return chunks.map((c, i) => ({ ...c, ordinal: i }));
}

function splitIntoParagraphs(text: string): string[] {
  // Split on double newlines for paragraphs
  const paras = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  // If a single paragraph is too large, split on sentences
  const result: string[] = [];
  for (const para of paras) {
    if (para.length <= MAX_CHUNK_SIZE) {
      result.push(para.trim());
    } else {
      // Split on sentence boundaries (ASCII and fullwidth CJK terminators)
      const sentences = para.match(/[^.!?。！？]+[.!?。！？]+[\s]*/g) || [para];
      let group = "";
      for (const sentence of sentences) {
        if (group.length + sentence.length > MAX_CHUNK_SIZE && group.length > 0) {
          pushWithHardSplit(result, group);
          group = sentence;
        } else {
          group += sentence;
        }
      }
      if (group.trim().length > 0) {
        pushWithHardSplit(result, group);
      }
    }
  }
  return result;
}

/**
 * Push a unit, hard-splitting anything still exceeding MAX_CHUNK_SIZE
 * (e.g. text with no sentence terminators at all) into fixed-size windows.
 * Windows leave room for the overlap prefix added during chunk assembly
 * so the assembled chunks stay within MAX_CHUNK_SIZE.
 */
function pushWithHardSplit(result: string[], unit: string): void {
  const trimmed = unit.trim();
  if (trimmed.length <= MAX_CHUNK_SIZE) {
    result.push(trimmed);
    return;
  }
  const windowSize = MAX_CHUNK_SIZE - OVERLAP_SIZE;
  for (let i = 0; i < trimmed.length; i += windowSize) {
    const window = trimmed.slice(i, i + windowSize).trim();
    if (window.length > 0) {
      result.push(window);
    }
  }
}

function getOverlap(text: string): string {
  if (text.length <= OVERLAP_SIZE) return text;
  // Try to find a sentence boundary near the overlap point
  const tail = text.slice(-OVERLAP_SIZE);
  const sentenceStart = tail.indexOf(". ");
  if (sentenceStart > 0 && sentenceStart < OVERLAP_SIZE / 2) {
    return tail.slice(sentenceStart + 2);
  }
  return tail;
}

function makeChunk(text: string, ordinal: number, pageNumber: number | null): Chunk {
  return {
    ordinal,
    pageNumber,
    text,
    textHash: sha256(Buffer.from(text)),
  };
}
