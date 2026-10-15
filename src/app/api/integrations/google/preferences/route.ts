import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { GOOGLE_COPY } from "@/lib/google/messages";
import { logger } from "@/lib/logger";
import { isValidTimezone } from "@/lib/timezone";

const preferencesSchema = z.object({
  default_calendar_id: z.string().min(1, "Choose a calendar.").optional(),
  busy_calendar_ids: z
    .array(z.string().min(1))
    .min(1, "Keep at least one calendar checked.")
    .optional(),
  timezone: z
    .string()
    .min(1)
    .refine(isValidTimezone, "Choose a time zone from the list, like America/New_York.")
    .optional(),
});

/**
 * POST /api/integrations/google/preferences: which calendar receives study
 * sessions and which calendars count as busy time for new plans.
 */
export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Your sign-in expired. Sign in again." }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration || integration.status === "DISCONNECTED") {
    return NextResponse.json(
      { error: GOOGLE_COPY.notConnected, code: "GOOGLE_NOT_CONNECTED" },
      { status: 400 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Calendar settings not saved. Retry." }, { status: 400 });
  }

  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Calendar settings not saved. Retry.",
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.default_calendar_id !== undefined) {
    data.calendarIdSelected = parsed.data.default_calendar_id;
  }
  if (parsed.data.busy_calendar_ids !== undefined) {
    data.busyCalendarIds = [...new Set(parsed.data.busy_calendar_ids)].join(",");
  }
  if (parsed.data.timezone !== undefined) {
    data.timezone = parsed.data.timezone;
  }

  try {
    await prisma.googleIntegration.update({
      where: { id: integration.id },
      data,
    });
  } catch (err) {
    logger.error("google.preferences.update_failed", { user_id: userId, error: String(err) });
    return NextResponse.json(
      { error: "Calendar settings not saved. Check your connection and retry." },
      { status: 500 },
    );
  }

  logger.info("google.preferences.updated", { user_id: userId, fields: Object.keys(data) });

  return NextResponse.json({
    default_calendar_id: (data.calendarIdSelected as string) ?? integration.calendarIdSelected,
    busy_calendar_ids:
      (data.busyCalendarIds as string | undefined)?.split(",") ??
      integration.busyCalendarIds.split(",").filter(Boolean),
    timezone: (data.timezone as string) ?? integration.timezone,
  });
}
