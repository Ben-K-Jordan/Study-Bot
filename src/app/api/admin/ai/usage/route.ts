/**
 * GET /api/admin/ai/usage — AI usage stats.
 *
 * Query params: user_id (optional), days (default 7)
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { generalLimiter, tooManyRequests } from "@/lib/rate-limit";

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = generalLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const filterUserId = userId;
  const daysRaw = parseInt(request.nextUrl.searchParams.get("days") || "7", 10);
  const days = Math.max(1, Math.min(Number.isNaN(daysRaw) ? 7 : daysRaw, 365));
  const since = new Date();
  since.setDate(since.getDate() - days);

  const logs = await prisma.aiCallLog.groupBy({
    by: ["task", "status"],
    where: {
      userId: filterUserId,
      createdAt: { gte: since },
    },
    _count: true,
    _sum: { costUsdMicros: true, tokenIn: true, tokenOut: true },
    _avg: { latencyMs: true },
  });

  const totalCostMicros = logs.reduce((sum, l) => sum + Number(l._sum.costUsdMicros ?? 0), 0);

  return NextResponse.json({
    user_id: userId,
    period_days: days,
    total_cost_usd: totalCostMicros / 1_000_000,
    breakdown: logs.map((l) => ({
      task: l.task,
      status: l.status,
      count: l._count,
      total_cost_usd: Number(l._sum.costUsdMicros ?? 0) / 1_000_000,
      total_tokens_in: l._sum.tokenIn ?? 0,
      total_tokens_out: l._sum.tokenOut ?? 0,
      avg_latency_ms: Math.round(l._avg.latencyMs ?? 0),
    })),
  });
}
