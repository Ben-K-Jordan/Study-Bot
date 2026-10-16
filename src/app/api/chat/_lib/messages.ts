import { prisma } from "@/lib/db";
import {
  isLegacyNoMatch,
  noticeText,
  storedCitations,
  storedNotice,
  toSources,
  type ChatSource,
} from "./sources";

export const MESSAGE_SELECT = { id: true, role: true, content: true, citations: true, createdAt: true } as const;

export type MessageRow = {
  id: string;
  role: string;
  content: string;
  citations: unknown;
  createdAt: Date;
};

export interface ChatMessageDto {
  id: string;
  role: "user" | "assistant";
  /** question: the student's; answer: AI-written; notice: the app's own line (no AI text). */
  kind: "question" | "answer" | "notice";
  content: string;
  /** Numbered sources: inline [n] in `content` refers to sources[n - 1]. */
  sources: ChatSource[];
  /** The stored citations JSON, unchanged. */
  citations: unknown;
  createdAt: string;
}

export function courseNameOf(courseKey: string): string {
  const i = courseKey.indexOf("||");
  return i === -1 ? courseKey : courseKey.slice(0, i);
}

/** Shapes stored rows for the client: kind, numbered sources with file titles and pages. */
export async function toMessageDtos(userId: string, courseKey: string, rows: MessageRow[]): Promise<ChatMessageDto[]> {
  const chunkIds = new Set<string>();
  for (const row of rows) {
    if (row.role === "assistant") for (const c of storedCitations(row.citations)) chunkIds.add(c.chunk_id);
  }

  const chunks = new Map<string, { title: string; page: number | null }>();
  if (chunkIds.size > 0) {
    const found = await prisma.contentChunk.findMany({
      where: { id: { in: [...chunkIds] }, document: { userId } },
      select: { id: true, pageNumber: true, document: { select: { title: true } } },
    });
    for (const c of found) chunks.set(c.id, { title: c.document.title, page: c.pageNumber });
  }

  const courseName = courseNameOf(courseKey);
  return rows.map((row) => {
    const role = row.role === "assistant" ? "assistant" : "user";
    const notice = role === "assistant" ? storedNotice(row.citations) : null;
    const legacyNotice = role === "assistant" && !notice && isLegacyNoMatch(row.content);
    if (notice || legacyNotice) {
      return {
        id: row.id,
        role,
        kind: "notice",
        content: noticeText(notice ?? "no_match", courseName),
        sources: [],
        citations: row.citations,
        createdAt: row.createdAt.toISOString(),
      };
    }
    return {
      id: row.id,
      role,
      kind: role === "assistant" ? "answer" : "question",
      content: row.content,
      sources: role === "assistant" ? toSources(storedCitations(row.citations), chunks) : [],
      citations: row.citations,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

