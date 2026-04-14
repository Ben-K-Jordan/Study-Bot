import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatLimiter, tooManyRequests } from "@/lib/rate-limit";

/**
 * GET /api/chat/messages?courseKey=CourseName||ExamName
 * Returns messages for the authenticated user + course, ordered by createdAt, limit 100.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courseKey = request.nextUrl.searchParams.get("courseKey");
  if (!courseKey) {
    return NextResponse.json({ error: "courseKey query parameter is required" }, { status: 400 });
  }

  try {
    const messages = await prisma.chatMessage.findMany({
      where: { userId, courseKey },
      orderBy: { createdAt: "asc" },
      take: 100,
    });

    return NextResponse.json({ messages });
  } catch (err) {
    logger.error("chat.messages.get_failed", { userId, courseKey, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const postSchema = z.object({
  courseKey: z.string().min(1).max(200),
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(50000),
  citations: z.any().optional(),
});

/**
 * POST /api/chat/messages
 * Saves a chat message and returns the created record.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = chatLimiter.check(userId);
  if (!rl.allowed) return tooManyRequests(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { courseKey, role, content, citations } = parsed.data;

  try {
    const message = await prisma.chatMessage.create({
      data: {
        userId,
        courseKey,
        role,
        content,
        citations: citations ?? undefined,
      },
    });

    logger.info("chat.message.created", { userId, courseKey, role, messageId: message.id });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    logger.error("chat.message.create_failed", { userId, courseKey, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/chat/messages?courseKey=CourseName||ExamName
 * Deletes all messages for the authenticated user + course (clear chat).
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const courseKey = request.nextUrl.searchParams.get("courseKey");
  if (!courseKey) {
    return NextResponse.json({ error: "courseKey query parameter is required" }, { status: 400 });
  }

  try {
    const result = await prisma.chatMessage.deleteMany({
      where: { userId, courseKey },
    });

    logger.info("chat.messages.cleared", { userId, courseKey, count: result.count });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    logger.error("chat.messages.clear_failed", { userId, courseKey, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
