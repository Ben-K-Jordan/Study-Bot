import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { processDocument } from "@/services/content";
import { aiLimiter, tooManyRequests } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: { documentId: string } }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  const { documentId } = await params;

  const result = await processDocument(userId, documentId);

  if ("error" in result) {
    if (result.error === "not_found") {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    if (result.error === "forbidden") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json(result.data);
}
