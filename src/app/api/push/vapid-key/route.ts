import { NextResponse } from "next/server";

/**
 * GET /api/push/vapid-key — return the VAPID public key so clients can subscribe.
 */
export async function GET() {
  return NextResponse.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
}
