import { prisma } from "@/lib/db";
import { emailProvider } from "@/lib/email/provider";
import {
  studyReminder,
  streakWarning,
  weeklyDigest,
  missedSession,
} from "@/lib/email/templates";
import { logger } from "@/lib/logger";

// ---------------------------------------------------------------------------
// Types for the JSON payload stored in ScheduledReminder.payload
// ---------------------------------------------------------------------------

interface StudyReminderPayload {
  name: string;
  items: string[];
  minutes: number;
}

interface StreakWarningPayload {
  name: string;
  streak: number;
}

interface WeeklyDigestPayload {
  name: string;
  stats: { sessions: number; xp: number; accuracy: number; streak: number };
}

interface MissedSessionPayload {
  name: string;
  sessionTitle: string;
}

// ---------------------------------------------------------------------------
// processScheduledReminders
// Finds all unsent reminders that are due and sends them.
// ---------------------------------------------------------------------------

export async function processScheduledReminders(): Promise<{
  processed: number;
  failed: number;
}> {
  const now = new Date();

  const dueReminders = await prisma.scheduledReminder.findMany({
    where: {
      sentAt: null,
      scheduledFor: { lte: now },
    },
    orderBy: { scheduledFor: "asc" },
    take: 200, // process in batches to avoid overloading
  });

  if (dueReminders.length === 0) {
    logger.info("process_reminders_none_due");
    return { processed: 0, failed: 0 };
  }

  logger.info("process_reminders_start", { count: dueReminders.length });

  let processed = 0;
  let failed = 0;

  for (const reminder of dueReminders) {
    try {
      // Look up the user's email (and check notification preferences)
      const user = await prisma.user.findUnique({
        where: { id: reminder.userId },
        include: { notificationPreference: true },
      });

      if (!user) {
        logger.warn("process_reminder_user_not_found", {
          reminderId: reminder.id,
          userId: reminder.userId,
        });
        // Mark as sent so we don't retry a missing user forever
        await prisma.scheduledReminder.update({
          where: { id: reminder.id },
          data: { sentAt: now },
        });
        failed++;
        continue;
      }

      // Check if user still has email reminders enabled
      const prefs = user.notificationPreference;
      if (prefs && !prefs.emailReminders) {
        logger.info("process_reminder_skipped_disabled", {
          reminderId: reminder.id,
          userId: user.id,
        });
        await prisma.scheduledReminder.update({
          where: { id: reminder.id },
          data: { sentAt: now },
        });
        processed++;
        continue;
      }

      const email = prefs?.emailAddress || user.email;
      const payload = reminder.payload as Record<string, unknown> | null;

      let subject: string;
      let html: string;

      switch (reminder.type) {
        case "STUDY_REMINDER": {
          const p = payload as unknown as StudyReminderPayload;
          const result = studyReminder(
            p?.name || user.name || "there",
            p?.items || ["Your scheduled study items"],
            p?.minutes || 30,
          );
          subject = result.subject;
          html = result.html;
          break;
        }

        case "STREAK_WARNING": {
          const p = payload as unknown as StreakWarningPayload;
          const result = streakWarning(
            p?.name || user.name || "there",
            p?.streak || 1,
          );
          subject = result.subject;
          html = result.html;
          break;
        }

        case "WEEKLY_DIGEST": {
          const p = payload as unknown as WeeklyDigestPayload;
          const result = weeklyDigest(
            p?.name || user.name || "there",
            p?.stats || { sessions: 0, xp: 0, accuracy: 0, streak: 0 },
          );
          subject = result.subject;
          html = result.html;
          break;
        }

        case "MISSED_SESSION": {
          const p = payload as unknown as MissedSessionPayload;
          const result = missedSession(
            p?.name || user.name || "there",
            p?.sessionTitle || "a study session",
          );
          subject = result.subject;
          html = result.html;
          break;
        }

        default:
          logger.warn("process_reminder_unknown_type", {
            reminderId: reminder.id,
            type: reminder.type,
          });
          await prisma.scheduledReminder.update({
            where: { id: reminder.id },
            data: { sentAt: now },
          });
          failed++;
          continue;
      }

      await emailProvider.send(email, subject, html);

      await prisma.scheduledReminder.update({
        where: { id: reminder.id },
        data: { sentAt: new Date() },
      });

      processed++;
    } catch (err) {
      logger.error("process_reminder_failed", {
        reminderId: reminder.id,
        error: String(err),
      });
      failed++;
    }
  }

  logger.info("process_reminders_done", { processed, failed });
  return { processed, failed };
}

// ---------------------------------------------------------------------------
// scheduleStudyReminders
// Creates ScheduledReminder records for a user's upcoming study plan items.
// ---------------------------------------------------------------------------

export async function scheduleStudyReminders(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { notificationPreference: true },
  });

  if (!user) throw new Error("User not found");

  const prefs = user.notificationPreference;
  if (prefs && !prefs.emailReminders) {
    logger.info("schedule_reminders_disabled", { userId });
    return 0;
  }

  // Default reminder time: 09:00, or whatever the user configured
  const reminderTime = prefs?.reminderTime || "09:00";
  const [hours, mins] = reminderTime.split(":").map(Number);

  // Find upcoming scheduled plan items (next 7 days)
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const plans = await prisma.studyPlan.findMany({
    where: { userId },
    include: {
      items: {
        where: {
          status: "SCHEDULED",
          startTime: { gte: now, lte: nextWeek },
        },
        orderBy: { startTime: "asc" },
      },
    },
  });

  // Batch-fetch all sessions referenced by plan items (avoids N+1)
  const allSessionIds = plans.flatMap((p) => p.items.map((i) => i.sessionId));
  const uniqueSessionIds = [...new Set(allSessionIds)];
  const sessions = await prisma.session.findMany({
    where: { sessionId: { in: uniqueSessionIds } },
  });
  const sessionMap = new Map(sessions.map((s) => [s.sessionId, s]));

  // Group items by date
  const itemsByDate = new Map<string, { titles: string[]; totalMinutes: number; planCourseName: string }>();

  for (const plan of plans) {
    for (const item of plan.items) {
      const dateKey = item.startTime.toISOString().split("T")[0];
      const entry = itemsByDate.get(dateKey) || {
        titles: [],
        totalMinutes: 0,
        planCourseName: plan.courseName,
      };

      const session = sessionMap.get(item.sessionId);
      const title = session
        ? `${session.topicScope} (${session.mode})`
        : `Study session`;
      entry.titles.push(title);
      entry.totalMinutes += session?.plannedMinutes || 30;
      itemsByDate.set(dateKey, entry);
    }
  }

  // Create a ScheduledReminder for each date that doesn't already have one
  let created = 0;

  for (const [dateKey, entry] of itemsByDate) {
    const scheduledFor = new Date(`${dateKey}T${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:00`);

    // Skip if already in the past
    if (scheduledFor <= now) continue;

    // Check if we already have a reminder for this user/date/type
    const existing = await prisma.scheduledReminder.findFirst({
      where: {
        userId,
        type: "STUDY_REMINDER",
        scheduledFor,
        sentAt: null,
      },
    });

    if (existing) continue;

    await prisma.scheduledReminder.create({
      data: {
        userId,
        type: "STUDY_REMINDER",
        scheduledFor,
        payload: {
          name: user.name || "there",
          items: entry.titles,
          minutes: entry.totalMinutes,
        },
      },
    });

    created++;
  }

  logger.info("schedule_reminders_created", { userId, created });
  return created;
}

// ---------------------------------------------------------------------------
// scheduleStreakReminder
// Schedules a streak warning for 8pm today if the user hasn't studied yet.
// ---------------------------------------------------------------------------

export async function scheduleStreakReminder(
  userId: string,
  streak: number,
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { notificationPreference: true },
  });

  if (!user) throw new Error("User not found");

  const prefs = user.notificationPreference;
  if (prefs && !prefs.streakReminders) {
    logger.info("streak_reminder_disabled", { userId });
    return false;
  }

  // Schedule for 8pm today
  const now = new Date();
  const target = new Date(now);
  target.setHours(20, 0, 0, 0);

  // If it's already past 8pm, don't schedule
  if (target <= now) {
    logger.info("streak_reminder_too_late", { userId });
    return false;
  }

  // Check if we already have a streak warning scheduled for today
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const existing = await prisma.scheduledReminder.findFirst({
    where: {
      userId,
      type: "STREAK_WARNING",
      scheduledFor: { gte: startOfDay, lte: endOfDay },
      sentAt: null,
    },
  });

  if (existing) {
    logger.info("streak_reminder_already_scheduled", { userId });
    return false;
  }

  await prisma.scheduledReminder.create({
    data: {
      userId,
      type: "STREAK_WARNING",
      scheduledFor: target,
      payload: {
        name: user.name || "there",
        streak,
      },
    },
  });

  logger.info("streak_reminder_scheduled", { userId, streak });
  return true;
}
