/**
 * GET /api/admin/search/health — Search subsystem health check.
 *
 * Reports: pgvector availability, embedding coverage, index stats.
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const adminIds = (process.env.ADMIN_USER_IDS || "").split(",").filter(Boolean);
  if (!adminIds.includes(userId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  try {
    // Check pgvector extension
    let pgvectorAvailable = false;
    try {
      await prisma.$queryRawUnsafe("SELECT 'test'::vector(3)");
      pgvectorAvailable = true;
    } catch {
      pgvectorAvailable = false;
    }

    // Embedding coverage stats
    const embeddingStats = await prisma.contentChunk.groupBy({
      by: ["embeddingStatus"],
      _count: true,
    });

    const statusMap = Object.fromEntries(
      embeddingStats.map((s) => [s.embeddingStatus, s._count]),
    );

    const totalChunks = Object.values(statusMap).reduce((a, b) => a + b, 0);
    const embeddedChunks = statusMap["DONE"] ?? 0;

    // Pending jobs count
    const pendingJobs = await prisma.jobQueue.count({
      where: { type: "EMBED_CHUNK_BATCH", status: { in: ["PENDING", "RETRY"] } },
    });

    return NextResponse.json({
      pgvector_available: pgvectorAvailable,
      hybrid_search_enabled: process.env.HYBRID_SEARCH_ENABLED === "true",
      total_chunks: totalChunks,
      embedded_chunks: embeddedChunks,
      embedding_coverage: totalChunks > 0 ? (embeddedChunks / totalChunks).toFixed(3) : "0",
      embedding_status: statusMap,
      pending_embed_jobs: pendingJobs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Health check failed" },
      { status: 500 },
    );
  }
}
