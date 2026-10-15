import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { generatePlanIcs } from "@/services/plan";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json(
      { error: "Your sign-in expired. Sign in again.", code: "unauthorized" },
      { status: 401 },
    );
  }

  const { planId } = await params;
  const result = await generatePlanIcs(userId, planId);

  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json(
        { error: "This plan doesn't exist anymore.", code: "not_found" },
        { status: 404 },
      );
    }
    return NextResponse.json(
      { error: "This plan belongs to another account.", code: "forbidden" },
      { status: 403 },
    );
  }

  return new NextResponse(result.data as string, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
