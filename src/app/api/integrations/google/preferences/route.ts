import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const preferencesSchema = z.object({
  default_calendar_id: z.string().min(1).optional(),
  busy_calendar_ids: z.array(z.string().min(1)).min(1, "At least one busy calendar required").optional(),
  timezone: z.string().min(1).optional(),
});

export async function POST(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
  });
  if (!integration || integration.status === "DISCONNECTED") {
    return NextResponse.json({ error: "Google Calendar not connected" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = preferencesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.default_calendar_id !== undefined) {
    data.calendarIdSelected = parsed.data.default_calendar_id;
  }
  if (parsed.data.busy_calendar_ids !== undefined) {
    data.busyCalendarIds = parsed.data.busy_calendar_ids.join(",");
  }
  if (parsed.data.timezone !== undefined) {
    data.timezone = parsed.data.timezone;
  }

  await prisma.googleIntegration.update({
    where: { id: integration.id },
    data,
  });

  logger.info("google.preferences.updated", { user_id: userId, ...parsed.data });

  return NextResponse.json({
    default_calendar_id: (data.calendarIdSelected as string) ?? integration.calendarIdSelected,
    busy_calendar_ids: parsed.data.busy_calendar_ids ?? integration.busyCalendarIds.split(",").filter(Boolean),
    timezone: (data.timezone as string) ?? integration.timezone,
  });
}
