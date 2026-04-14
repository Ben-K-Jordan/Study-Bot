import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { generateStudyGuide, listStudyGuides } from "@/services/study-guides";
import { GatewayError } from "@/lib/ai/gateway";
import { logger } from "@/lib/logger";

const generateSchema = z.object({
  course_name: z.string().min(1),
  exam_name: z.string().optional(),
  guide_type: z.enum(["KEY_CONCEPTS", "FAQ", "CHEAT_SHEET"]),
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

  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { course_name, exam_name, guide_type } = parsed.data;

  try {
    const guide = await generateStudyGuide(userId, course_name, exam_name, guide_type);
    return NextResponse.json(guide, { status: 201 });
  } catch (err) {
    if (err instanceof GatewayError) {
      const status = err.code === "BUDGET_EXCEEDED" ? 429 : err.code === "AI_DISABLED" ? 503 : 502;
      return NextResponse.json({ error: err.message, code: err.code }, { status });
    }
    if (err instanceof Error && err.message.includes("No course materials")) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    logger.error("guides.generate_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const courseName = searchParams.get("course_name") || undefined;
  const examName = searchParams.get("exam_name") || undefined;

  try {
    const guides = await listStudyGuides(userId, courseName, examName);
    return NextResponse.json({ guides });
  } catch (err) {
    logger.error("guides.list_failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
