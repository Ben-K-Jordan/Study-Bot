import { NextRequest, NextResponse } from "next/server";
import { z } from "zod/v4";
import { getUserId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

const deleteSchema = z.object({
  confirm: z.literal("DELETE MY ACCOUNT"),
});

/**
 * DELETE /api/account/delete
 * GDPR account deletion: permanently deletes the user and all associated data.
 */
export async function DELETE(request: NextRequest) {
  const userId = await getUserId(request);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed. Body must include { confirm: \"DELETE MY ACCOUNT\" }.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Delete models that reference User but may lack onDelete: Cascade
      await tx.scheduledReminder.deleteMany({ where: { userId } });
      await tx.chatMessage.deleteMany({ where: { userId } });
      await tx.pushSubscription.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });

      // Delete the User record — models with onDelete: Cascade on the User
      // relation will be cleaned up automatically by the database, but we
      // already removed the four above explicitly for safety.
      await tx.user.delete({ where: { id: userId } });
    });

    logger.info("account.deleted", { userId });

    return NextResponse.json({ deleted: true });
  } catch (err) {
    logger.error("account.delete.failed", { userId, error: String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
