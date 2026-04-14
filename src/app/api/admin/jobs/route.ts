/**
 * GET /api/admin/jobs — Job queue stats and recent jobs.
 *
 * Query params: status (optional), limit (default 20)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const statusFilter = request.nextUrl.searchParams.get("status");
  const limit = Math.min(parseInt(request.nextUrl.searchParams.get("limit") || "20", 10), 100);

  const where = statusFilter ? { status: statusFilter } : {};

  const [counts, recentJobs] = await Promise.all([
    prisma.jobQueue.groupBy({
      by: ["status"],
      _count: true,
    }),
    prisma.jobQueue.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        status: true,
        priority: true,
        attempts: true,
        maxAttempts: true,
        lastError: true,
        createdAt: true,
        updatedAt: true,
        runAfter: true,
      },
    }),
  ]);

  return NextResponse.json({
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    jobs: recentJobs.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      priority: j.priority,
      attempts: j.attempts,
      max_attempts: j.maxAttempts,
      last_error: j.lastError,
      created_at: j.createdAt.toISOString(),
      updated_at: j.updatedAt.toISOString(),
      run_after: j.runAfter.toISOString(),
    })),
  });
}
