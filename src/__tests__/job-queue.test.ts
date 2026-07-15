/**
 * Unit tests for job queue stale-lock recovery.
 *
 * Verifies that recoverStaleJobs reclaims jobs left RUNNING by a crashed
 * worker, resetting them to RETRY (or FAILED when attempts are exhausted).
 */
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

// Mock prisma before importing the queue module
vi.mock("@/lib/db", () => ({
  prisma: {
    $executeRawUnsafe: vi.fn(async () => 0),
    $queryRawUnsafe: vi.fn(async () => []),
    jobQueue: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "job-1", ...data })),
      update: vi.fn(async () => ({})),
    },
  },
}));

import { recoverStaleJobs } from "@/lib/jobs/queue";
import { prisma } from "@/lib/db";

const executeRawMock = prisma.$executeRawUnsafe as unknown as Mock;

/** Collapse whitespace so SQL assertions are not layout-sensitive. */
function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("recoverStaleJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets stale RUNNING jobs and clears their lock", async () => {
    await recoverStaleJobs();

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const sql = normalizeSql(executeRawMock.mock.calls[0][0] as string);

    expect(sql).toContain("UPDATE job_queue");
    expect(sql).toContain("WHERE status = 'RUNNING'");
    expect(sql).toContain("locked_at < NOW() - ($1::int * interval '1 millisecond')");
    expect(sql).toContain("locked_at = NULL");
    expect(sql).toContain("locked_by = NULL");
  });

  it("respects attempts/maxAttempts: RETRY when attempts remain, FAILED when exhausted", async () => {
    await recoverStaleJobs();

    const sql = normalizeSql(executeRawMock.mock.calls[0][0] as string);
    expect(sql).toContain("CASE WHEN attempts >= max_attempts THEN 'FAILED' ELSE 'RETRY' END");
  });

  it("uses a 10 minute threshold by default", async () => {
    await recoverStaleJobs();

    expect(executeRawMock.mock.calls[0][1]).toBe(10 * 60 * 1000);
  });

  it("accepts a custom staleness threshold", async () => {
    await recoverStaleJobs(30_000);

    expect(executeRawMock.mock.calls[0][1]).toBe(30_000);
  });

  it("returns the number of recovered jobs", async () => {
    executeRawMock.mockResolvedValueOnce(3);

    await expect(recoverStaleJobs()).resolves.toBe(3);
  });
});
