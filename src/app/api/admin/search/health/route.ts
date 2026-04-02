/**
 * GET /api/admin/search/health — Search subsystem health check.
 *
 * Reports: pgvector availability, embedding coverage, index stats.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
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
      { error: "Health check failed", detail: String(err) },
      { status: 500 },
    );
  }
}
