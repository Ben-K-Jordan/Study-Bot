import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { getPlan } from "@/services/plan";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId } = await params;
  const result = await getPlan(userId, planId);

  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Plan not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json(result.data);
}
