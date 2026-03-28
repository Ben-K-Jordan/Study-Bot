import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { generatePlanIcs } from "@/services/plan";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;
  const result = await generatePlanIcs(userId, planId);

  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return new NextResponse(result.data as string, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="study-plan-${planId}.ics"`,
    },
  });
}
