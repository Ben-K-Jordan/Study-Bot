import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generatePlanIcs } from "@/services/plan";

/**
 * Public ICS feed endpoint for webcal:// subscription.
 * No X-User-Id header required — uses planId as implicit auth
 * (plan IDs are unguessable UUIDs).
 *
 * Usage: webcal://host/api/plans/{planId}/feed
 * Google Calendar and other clients can subscribe to this URL.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const { planId } = await params;

  // Look up the plan to get the userId (needed by generatePlanIcs)
  const plan = await prisma.studyPlan.findUnique({
    where: { planId },
    select: { userId: true },
  });

  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const result = await generatePlanIcs(plan.userId, planId);

  if ("error" in result) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  return new NextResponse(result.data as string, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "public, max-age=300",
    },
  });
}
