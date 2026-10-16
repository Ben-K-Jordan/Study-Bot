import { NextRequest, NextResponse } from "next/server";
import { unauthorized } from "@/lib/http";
import { getUserId } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { publicConfig } from "@/lib/public-config";
import { readSettings, writeSettings } from "@/services/settings";
import {
  SETTINGS_INVALID_MESSAGE,
  fieldErrorsFromIssues,
  mergeSettings,
  settingsUpdateSchema,
  validateSettings,
} from "./schema";


/**
 * GET /api/settings: the student's study settings. Students who never saved
 * any get the defaults (nothing is written on read).
 */
export async function GET(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  try {
    const settings = await readSettings(userId);
    return NextResponse.json({
      ...settings,
      google_configured: publicConfig().google_configured,
    });
  } catch (err) {
    logger.error("settings.read_failed", { user_id: userId, error: String(err) });
    return NextResponse.json({ error: "Settings didn't load. Retry." }, { status: 500 });
  }
}

/**
 * PUT /api/settings: update some or all study settings. The update is
 * merged onto the saved values and checked as a whole, so an end time
 * before the start time is rejected even when only one of them changes.
 * Rejections carry `fields`, one instruction per field.
 */
export async function PUT(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return unauthorized();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Settings not saved. Retry." }, { status: 400 });
  }

  const parsed = settingsUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: SETTINGS_INVALID_MESSAGE,
        fields: fieldErrorsFromIssues(parsed.error.issues),
        issues: parsed.error.issues,
      },
      { status: 400 },
    );
  }

  try {
    const current = await readSettings(userId);
    const next = mergeSettings(current, parsed.data);
    const fields = validateSettings(next);
    if (Object.keys(fields).length > 0) {
      return NextResponse.json({ error: SETTINGS_INVALID_MESSAGE, fields }, { status: 400 });
    }

    const saved = await writeSettings(userId, next);
    logger.info("settings.updated", { user_id: userId, fields: Object.keys(parsed.data) });
    return NextResponse.json(saved);
  } catch (err) {
    logger.error("settings.update_failed", { user_id: userId, error: String(err) });
    return NextResponse.json(
      { error: "Settings not saved. Check your connection and retry." },
      { status: 500 },
    );
  }
}
