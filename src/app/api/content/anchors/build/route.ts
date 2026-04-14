import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { buildObjectiveAnchors } from "@/services/anchors";
import { z } from "zod/v4";
import { logger } from "@/lib/logger";

const buildAnchorsSchema = z.object({
  course_name: z.string().min(1),
  exam_name: z.string().optional(),
  objectives: z.array(z.object({ id: z.string(), title: z.string() })).min(1),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let parsed;
  try {
    parsed = buildAnchorsSchema.parse(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Validation failed", issues: err.issues },
        { status: 400 }
      );
    }
    throw err;
  }

  try {
    const result = await buildObjectiveAnchors(
      userId,
      parsed.course_name,
      parsed.exam_name,
      parsed.objectives
    );
    return NextResponse.json(result);
  } catch (err) {
    logger.error("build_anchors_failed", { error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
