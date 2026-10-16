/**
 * GET /api/admin/jobs — Job queue stats and recent jobs.
 *
 * Query params: status (optional), limit (default 20)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/admin";

export async function GET(request: NextRequest) {
  const admin = await requireAdmin(request);
  if ("response" in admin) return admin.response;

  const statusFilter = request.nextUrl.searchParams.get("status");
  const limitRaw = parseInt(request.nextUrl.searchParams.get("limit") || "20", 10);
  const limit = Math.max(1, Math.min(Number.isNaN(limitRaw) ? 20 : limitRaw, 100));

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
      last_error: j.lastError ? j.lastError.slice(0, 200) : null,
      created_at: j.createdAt.toISOString(),
      updated_at: j.updatedAt.toISOString(),
      run_after: j.runAfter.toISOString(),
    })),
  });
}
