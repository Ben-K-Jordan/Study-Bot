/**
 * Unit tests for uploadDocument — save-first ordering, dedupe, and the
 * concurrent-upload (P2002) race.
 *
 * Uses in-memory Prisma + storage mocks to isolate the upload flow.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma before importing the service
vi.mock("@/lib/db", () => ({
  prisma: {
    contentDocument: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/storage", () => ({
  sha256: vi.fn(() => "hash-abc"),
  saveFile: vi.fn(
    async (userId: string, documentId: string, filename: string) =>
      `${userId}/${documentId}/${filename}`,
  ),
  resolveStoragePath: vi.fn((key: string) => `/uploads/${key}`),
}));

import { uploadDocument } from "@/services/content";
import { prisma } from "@/lib/db";
import { saveFile } from "@/lib/storage";

const findUniqueMock = prisma.contentDocument.findUnique as ReturnType<typeof vi.fn>;
const createMock = prisma.contentDocument.create as ReturnType<typeof vi.fn>;
const updateMock = prisma.contentDocument.update as ReturnType<typeof vi.fn>;
const saveFileMock = saveFile as ReturnType<typeof vi.fn>;

function upload() {
  return uploadDocument(
    "user-1",
    "COURSE",
    "Biology",
    "Midterm 1",
    "Notes",
    "notes.txt",
    "text/plain",
    Buffer.from("hello"),
  );
}

describe("uploadDocument", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createMock.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
    }));
  });

  it("returns the existing document without saving when the hash matches", async () => {
    findUniqueMock.mockResolvedValueOnce({ id: "doc-existing", status: "PROCESSED" });

    const result = await upload();

    expect(result).toEqual({
      document_id: "doc-existing",
      status: "PROCESSED",
      deduped: true,
    });
    expect(saveFileMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("saves the file before creating the row and stores the real storage key", async () => {
    findUniqueMock.mockResolvedValueOnce(null);

    const result = await upload();

    expect(result.deduped).toBe(false);
    expect(result.status).toBe("UPLOADED");

    // File is written before the row exists
    expect(saveFileMock.mock.invocationCallOrder[0]).toBeLessThan(
      createMock.mock.invocationCallOrder[0],
    );

    // Row is created with the real storage key — never an empty placeholder
    const createData = createMock.mock.calls[0][0].data;
    expect(createData.id).toBeTruthy();
    expect(createData.storageKey).toBe(`user-1/${createData.id}/notes.txt`);
    expect(createData.contentHash).toBe("hash-abc");
    expect(result.document_id).toBe(createData.id);

    // No post-create storageKey fixup needed
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("does not create a document row when saving the file fails", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    saveFileMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(upload()).rejects.toThrow("disk full");

    // No broken row is left behind to wedge the dedupe check
    expect(createMock).not.toHaveBeenCalled();

    // A retry after the failure succeeds normally
    findUniqueMock.mockResolvedValueOnce(null);
    const retry = await upload();
    expect(retry.deduped).toBe(false);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns the winning row as a dedupe hit when a concurrent upload causes P2002", async () => {
    findUniqueMock
      .mockResolvedValueOnce(null) // dedupe check passes for both racers
      .mockResolvedValueOnce({ id: "doc-winner", status: "UPLOADED" }); // re-read after P2002
    createMock.mockRejectedValueOnce(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await upload();

    expect(result).toEqual({
      document_id: "doc-winner",
      status: "UPLOADED",
      deduped: true,
    });
    expect(findUniqueMock).toHaveBeenCalledTimes(2);
  });

  it("rethrows non-P2002 create errors", async () => {
    findUniqueMock.mockResolvedValueOnce(null);
    createMock.mockRejectedValueOnce(new Error("connection lost"));

    await expect(upload()).rejects.toThrow("connection lost");
  });
});
