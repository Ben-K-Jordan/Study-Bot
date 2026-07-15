import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserId } from "@/lib/auth";
import { z } from "zod/v4";

const prefsSchema = z.object({
  emailReminders: z.boolean().optional(),
  pushReminders: z.boolean().optional(),
  reminderTime: z
    .string()
    .regex(/^\d{2}:\d{2}$/, "Must be HH:MM format")
    .refine((v) => {
      const [h, m] = v.split(":").map(Number);
      return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }, "Invalid time")
    .optional(),
  streakReminders: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
  emailAddress: z.string().email().nullable().optional(),
});

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

  let body: z.infer<typeof prefsSchema>;
  try {
    body = prefsSchema.parse(await request.json());
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: "Validation error", details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

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
