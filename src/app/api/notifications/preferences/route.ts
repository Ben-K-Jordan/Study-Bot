import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const prefs = await prisma.notificationPreference.findUnique({
    where: { userId },
  });

  if (!prefs) {
    // Return defaults
    return NextResponse.json({
      emailReminders: true,
      pushReminders: true,
      reminderTime: "09:00",
      streakReminders: true,
      weeklyDigest: true,
      emailAddress: null,
    });
  }

  return NextResponse.json({
    emailReminders: prefs.emailReminders,
    pushReminders: prefs.pushReminders,
    reminderTime: prefs.reminderTime,
    streakReminders: prefs.streakReminders,
    weeklyDigest: prefs.weeklyDigest,
    emailAddress: prefs.emailAddress,
  });
}

export async function PUT(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();

  const prefs = await prisma.notificationPreference.upsert({
    where: { userId },
    create: {
      userId,
      emailReminders: body.emailReminders ?? true,
      pushReminders: body.pushReminders ?? true,
      reminderTime: body.reminderTime ?? "09:00",
      streakReminders: body.streakReminders ?? true,
      weeklyDigest: body.weeklyDigest ?? true,
      emailAddress: body.emailAddress ?? null,
    },
    update: {
      ...(body.emailReminders !== undefined && { emailReminders: body.emailReminders }),
      ...(body.pushReminders !== undefined && { pushReminders: body.pushReminders }),
      ...(body.reminderTime !== undefined && { reminderTime: body.reminderTime }),
      ...(body.streakReminders !== undefined && { streakReminders: body.streakReminders }),
      ...(body.weeklyDigest !== undefined && { weeklyDigest: body.weeklyDigest }),
      ...(body.emailAddress !== undefined && { emailAddress: body.emailAddress }),
    },
  });

  return NextResponse.json({
    emailReminders: prefs.emailReminders,
    pushReminders: prefs.pushReminders,
    reminderTime: prefs.reminderTime,
    streakReminders: prefs.streakReminders,
    weeklyDigest: prefs.weeklyDigest,
    emailAddress: prefs.emailAddress,
  });
}
