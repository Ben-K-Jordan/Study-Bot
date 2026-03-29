import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { searchChunks } from "@/lib/search";
import { searchContentSchema } from "@/lib/validation-content";
import { z } from "zod/v4";

export async function POST(request: NextRequest) {
  const userId = getUserId(request.headers);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const parsed = searchContentSchema.parse(body);

    const results = await searchChunks({
      userId,
      q: parsed.q,
      namespace: parsed.namespace,
      courseName: parsed.course_name,
      examName: parsed.exam_name,
      topK: parsed.top_k,
    });

    return NextResponse.json({ results });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    console.error("Search failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
