import webpush from "web-push";
import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";

// ── Lazy VAPID configuration (avoids crashes at build time) ───
let vapidConfigured = false;
function ensureVapid() {
  if (vapidConfigured) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error("VAPID env vars (VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY) are not set");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

/**
 * Send a push notification to every registered device for a user.
 *
 * - Fetches all PushSubscription rows for the given userId
 * - Fires a web-push to each subscription in parallel
 * - Silently removes subscriptions that return 410 (expired / unsubscribed)
 * - Logs errors but never throws — callers don't need to handle push failures
 */
export async function sendPushNotification(
  userId: string,
  title: string,
  body: string,
  url?: string,
): Promise<void> {
  try {
    ensureVapid();

    const subscriptions = await prisma.pushSubscription.findMany({
      where: { userId },
    });

    if (subscriptions.length === 0) return;

    const payload = JSON.stringify({ title, body, url, icon: "/assets/icon-192.png" });

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            payload,
          );
        } catch (err: unknown) {
          const statusCode =
            err instanceof webpush.WebPushError ? err.statusCode : undefined;

          if (statusCode === 410) {
            // Subscription expired — clean it up
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
            logger.info("Deleted expired push subscription", {
              subscriptionId: sub.id,
              userId,
            });
          } else {
            logger.error("Failed to send push notification", {
              subscriptionId: sub.id,
              userId,
              error: err instanceof Error ? err.message : String(err),
              statusCode,
            });
          }
        }
      }),
    );

    const sent = results.filter((r) => r.status === "fulfilled").length;
    logger.info("Push notifications dispatched", { userId, total: subscriptions.length, sent });
  } catch (err) {
    logger.error("sendPushNotification failed", {
      userId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
