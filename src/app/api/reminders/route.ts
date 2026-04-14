import { NextRequest, NextResponse } from "next/server";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { scheduleStudyReminders } from "@/lib/email/scheduler";
import { logger } from "@/lib/logger";

// GET /api/reminders — list the authenticated user's scheduled reminders
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const reminders = await prisma.scheduledReminder.findMany({
      where: { userId },
      orderBy: { scheduledFor: "desc" },
      take: 50,
    });

    return NextResponse.json({
      reminders: reminders.map((r) => ({
        id: r.id,
        type: r.type,
        scheduled_for: r.scheduledFor.toISOString(),
        sent_at: r.sentAt?.toISOString() ?? null,
        payload: r.payload,
        created_at: r.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    logger.error("list_reminders_failed", { error: String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// POST /api/reminders — schedule study reminders for the authenticated user
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const created = await scheduleStudyReminders(userId);
    return NextResponse.json(
      { message: `Scheduled ${created} reminder(s)`, created },
      { status: 201 },
    );
  } catch (err) {
    logger.error("schedule_reminders_failed", {
      userId,
      error: String(err),
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
