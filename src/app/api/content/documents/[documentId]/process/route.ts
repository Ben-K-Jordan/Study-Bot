import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { processDocument } from "@/services/content";
import { aiLimiter, tooManyRequests } from "@/lib/rate-limit";
import { unauthorized } from "@/lib/http";
import { retryAfterText } from "@/lib/format";

/**
 * POST /api/content/documents/{id}/process: read the file into sections.
 * Responds with `status` PROCESSED, FAILED, or PROCESSING when another
 * request is already reading the file (check back; don't start over).
 * Limited like other AI work; a 429 carries Retry-After, and the screen
 * retries after it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const rl = aiLimiter.check(userId);
  if (!rl.allowed) {
    const seconds = Math.ceil(rl.retryAfterMs / 1000);
    return tooManyRequests(rl.retryAfterMs, `Too many files at once. ${retryAfterText(seconds)}`);
  }

  const { documentId } = await params;

  const result = await processDocument(userId, documentId);

  if ("error" in result) {
    if (result.error === "forbidden") {
      return NextResponse.json(
        { error: "This file belongs to another account.", code: "forbidden" },
        { status: 403 },
      );
    }
    return NextResponse.json(
      { error: "This file isn't in your materials anymore.", code: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json(result.data);
}
