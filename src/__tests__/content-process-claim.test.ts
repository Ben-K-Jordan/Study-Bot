/**
 * processDocument claims a file before reading it, so a second request (a
 * double click, another tab) never runs a second extraction, and a claim
 * from a run that died lapses.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    contentDocument: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    contentChunk: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/storage", () => ({
  sha256: vi.fn(),
  saveFile: vi.fn(),
  deleteStoredFile: vi.fn(),
  resolveStoragePath: vi.fn((key: string) => `/uploads/${key}`),
}));

vi.mock("@/lib/extractor", () => ({ extractDocumentText: vi.fn() }));

import { PROCESSING_CLAIM_MS, processDocument, visibleDocumentStatus } from "@/services/content";
import { prisma } from "@/lib/db";
import { extractDocumentText } from "@/lib/extractor";

const findUnique = prisma.contentDocument.findUnique as ReturnType<typeof vi.fn>;
const updateMany = prisma.contentDocument.updateMany as ReturnType<typeof vi.fn>;
const chunkCount = prisma.contentChunk.count as ReturnType<typeof vi.fn>;
const extract = extractDocumentText as ReturnType<typeof vi.fn>;

const DOC = {
  id: "doc-1",
  userId: "user-1",
  status: "UPLOADED",
  storageKey: "user-1/doc-1/notes.txt",
  mimeType: "text/plain",
  title: "Notes",
  courseName: "CS 2110",
  examName: null,
};

describe("processDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("answers PROCESSING without extracting when another request holds the claim", async () => {
    findUnique.mockResolvedValueOnce({ ...DOC, status: "PROCESSING" }).mockResolvedValueOnce({ status: "PROCESSING" });
    updateMany.mockResolvedValueOnce({ count: 0 });

    const result = await processDocument("user-1", "doc-1");

    expect(result).toEqual({ data: { document_id: "doc-1", status: "PROCESSING", chunk_count: 0 } });
    expect(extract).not.toHaveBeenCalled();
  });

  it("answers PROCESSED when the other request finished in the meantime", async () => {
    findUnique.mockResolvedValueOnce(DOC).mockResolvedValueOnce({ status: "PROCESSED" });
    updateMany.mockResolvedValueOnce({ count: 0 });
    chunkCount.mockResolvedValueOnce(4);

    const result = await processDocument("user-1", "doc-1");

    expect(result).toEqual({ data: { document_id: "doc-1", status: "PROCESSED", chunk_count: 4 } });
    expect(extract).not.toHaveBeenCalled();
  });

  it("claims only uploaded or failed files, or a claim that lapsed", async () => {
    findUnique.mockResolvedValueOnce(DOC);
    updateMany.mockResolvedValueOnce({ count: 1 });
    extract.mockRejectedValueOnce(new Error("unreadable"));

    await processDocument("user-1", "doc-1");

    const where = updateMany.mock.calls[0][0].where;
    expect(where.id).toBe("doc-1");
    expect(where.OR[0]).toEqual({ status: { in: ["UPLOADED", "FAILED"] } });
    expect(where.OR[1].status).toBe("PROCESSING");
    expect(Date.now() - where.OR[1].updatedAt.lt.getTime()).toBeGreaterThanOrEqual(PROCESSING_CLAIM_MS - 1000);
    expect(updateMany.mock.calls[0][0].data.status).toBe("PROCESSING");
    expect(extract).toHaveBeenCalledTimes(1);
  });
});

describe("visibleDocumentStatus", () => {
  const now = new Date("2026-10-15T20:00:00Z");

  it("shows a fresh claim as processing and a lapsed one as uploaded", () => {
    expect(visibleDocumentStatus("PROCESSING", new Date(now.getTime() - 60_000), now)).toBe("PROCESSING");
    expect(visibleDocumentStatus("PROCESSING", new Date(now.getTime() - PROCESSING_CLAIM_MS - 1), now)).toBe("UPLOADED");
    expect(visibleDocumentStatus("PROCESSED", new Date(0), now)).toBe("PROCESSED");
  });
});
