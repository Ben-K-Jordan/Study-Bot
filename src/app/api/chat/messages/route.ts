import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { chatLimiter } from "@/lib/rate-limit";
import { failed, invalidInput, invalidJson, rateLimited, unauthorized } from "../../flashcards/_lib/http";
import { MESSAGE_SELECT, toMessageDtos } from "../_lib/messages";

const listSchema = z.object({
  courseKey: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  before: z.string().min(1).max(100).optional(),
});

/**
 * GET /api/chat/messages?courseKey=Course||Exam&limit=50&before=<messageId>
 * The newest `limit` messages (older than `before` when given), returned
 * oldest first, with `has_more` and the course's total message count.
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = chatLimiter.check(userId);
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  const sp = request.nextUrl.searchParams;
  const parsed = listSchema.safeParse({
    courseKey: sp.get("courseKey") ?? undefined,
    limit: sp.get("limit") ?? undefined,
    before: sp.get("before") ?? undefined,
  });
  if (!parsed.success) return invalidInput(parsed.error, "Choose a course to see its chat.");
  const { courseKey, limit, before } = parsed.data;

  try {
    let cursor: Record<string, unknown> = {};
    if (before) {
      const anchor = await prisma.chatMessage.findFirst({
        where: { id: before, userId, courseKey },
        select: { id: true, createdAt: true },
      });
      if (!anchor) {
        return failed("Those messages aren't in this chat anymore. Reload to see the latest.", 404, "CURSOR_NOT_FOUND");
      }
      cursor = {
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ],
      };
    }

    const [rows, total] = await Promise.all([
      prisma.chatMessage.findMany({
        where: { userId, courseKey, ...cursor },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: limit + 1,
        select: MESSAGE_SELECT,
      }),
      prisma.chatMessage.count({ where: { userId, courseKey } }),
    ]);

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    const messages = await toMessageDtos(userId, courseKey, page);

    return NextResponse.json({ messages, has_more: hasMore, total });
  } catch (err) {
    logger.error("chat.messages.get_failed", { userId, courseKey, error: String(err) });
    return failed("Chat history didn't load. Retry");
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
 * Saves a chat message and returns the created record. (The chat screen
 * saves through /api/assistant/answer with save: true instead.)
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const rl = chatLimiter.check(userId);
  if (!rl.allowed) return rateLimited(rl.retryAfterMs);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return invalidJson();
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) return invalidInput(parsed.error);

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
      select: MESSAGE_SELECT,
    });

    logger.info("chat.message.created", { userId, courseKey, role, messageId: message.id });
    return NextResponse.json({ message }, { status: 201 });
  } catch (err) {
    logger.error("chat.message.create_failed", { userId, courseKey, error: String(err) });
    return failed("Message not saved. Retry");
  }
}

/**
 * DELETE /api/chat/messages?courseKey=CourseName||ExamName
 * Deletes all messages for the authenticated user + course.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) return unauthorized();

  const courseKey = request.nextUrl.searchParams.get("courseKey");
  if (!courseKey) return failed("Choose a course to delete its chat history.", 400, "INVALID_INPUT");

  try {
    const result = await prisma.chatMessage.deleteMany({
      where: { userId, courseKey },
    });

    logger.info("chat.messages.cleared", { userId, courseKey, count: result.count });
    return NextResponse.json({ deleted: result.count });
  } catch (err) {
    logger.error("chat.messages.clear_failed", { userId, courseKey, error: String(err) });
    return failed("Chat history not deleted. Retry");
  }
}
