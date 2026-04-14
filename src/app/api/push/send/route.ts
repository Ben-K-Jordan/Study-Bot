import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { sendPushNotification } from "@/lib/push";
import {
  STUDY_REMINDERS,
  STREAK_WARNINGS,
  ACHIEVEMENT_UNLOCKED,
  WEEKLY_NUDGE,
  pickRandom,
  formatMessage,
} from "@/lib/push/messages";
import { logger } from "@/lib/logger";

const notificationType = z.enum([
  "STUDY_REMINDER",
  "STREAK_WARNING",
  "ACHIEVEMENT",
  "WEEKLY_NUDGE",
]);

const sendSchema = z.object({
  userId: z.string().min(1),
  type: notificationType,
  data: z.record(z.string(), z.string()).optional(),
});

const MESSAGE_MAP: Record<z.infer<typeof notificationType>, readonly string[]> = {
  STUDY_REMINDER: STUDY_REMINDERS,
  STREAK_WARNING: STREAK_WARNINGS,
  ACHIEVEMENT: ACHIEVEMENT_UNLOCKED,
  WEEKLY_NUDGE: WEEKLY_NUDGE,
};

const TITLE_MAP: Record<z.infer<typeof notificationType>, string> = {
  STUDY_REMINDER: "Time to Study!",
  STREAK_WARNING: "Streak Alert!",
  ACHIEVEMENT: "Achievement Unlocked!",
  WEEKLY_NUDGE: "Weekly Check-in",
};

/**
 * POST /api/push/send — send a push notification (admin / internal use).
 *
 * Body: { userId, type, data? }
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = sendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 400 },
    );
  }

  const { userId, type, data } = parsed.data;

  const messages = MESSAGE_MAP[type];
  const rawMessage = pickRandom(messages);
  const message = formatMessage(rawMessage, data);
  const title = TITLE_MAP[type];

  logger.info("Sending push notification", { userId, type, title });

  await sendPushNotification(userId, title, message, "/");

  return NextResponse.json({ ok: true, title, message }, { status: 200 });
}
