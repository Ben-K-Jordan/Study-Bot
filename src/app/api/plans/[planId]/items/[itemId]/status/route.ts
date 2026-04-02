import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { z } from "zod/v4";
import { ITEM_STATUSES } from "@/services/reflow";

const updateStatusSchema = z.object({
  status: z.enum(ITEM_STATUSES),
  locked: z.boolean().optional(),
  completed_run_id: z.string().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ planId: string; itemId: string }> },
) {
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Missing X-User-Id header" }, { status: 401 });
  }

  const { planId, itemId } = await params;

  // Verify plan ownership
  const plan = await prisma.studyPlan.findUnique({ where: { planId } });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.userId !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Verify item belongs to plan
  const item = await prisma.studyPlanItem.findFirst({
    where: { id: itemId, planId },
  });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  // Parse body
  let body: z.infer<typeof updateStatusSchema>;
  try {
    body = updateStatusSchema.parse(await req.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Build update data
  const now = new Date();
  const updateData: Record<string, unknown> = { status: body.status };

  if (body.locked !== undefined) {
    updateData.locked = body.locked;
  }

  if (body.status === "DONE") {
    updateData.completedAt = now;
    if (body.completed_run_id) {
      updateData.completedRunId = body.completed_run_id;
    }
  } else if (body.status === "MISSED") {
    updateData.missedAt = now;
  }

  const updated = await prisma.studyPlanItem.update({
    where: { id: itemId },
    data: updateData,
  });

  return NextResponse.json({
    id: updated.id,
    status: updated.status,
    locked: updated.locked,
    completed_at: updated.completedAt?.toISOString() ?? null,
    missed_at: updated.missedAt?.toISOString() ?? null,
  });
}
