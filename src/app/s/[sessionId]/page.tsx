import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getCurrentUserId } from "@/lib/auth";
import { PreflightSkeleton } from "@/components/session/skeletons";
import { getSessionScreen, isSessionOwner } from "@/services/session";
import { SessionRunner } from "./session-runner";

interface SessionPageProps {
  params: Promise<{ sessionId: string }>;
}

/** One lookup per request, shared by the title and the page. */
const loadSessionScreen = cache(async (sessionId: string) => {
  const userId = await getCurrentUserId();
  if (!userId) return { signedOut: true as const };
  const result = await getSessionScreen(userId, sessionId);
  return { signedOut: false as const, result };
});

export async function generateMetadata({ params }: SessionPageProps): Promise<Metadata> {
  const { sessionId } = await params;
  const loaded = await loadSessionScreen(sessionId);
  if (loaded.signedOut || "error" in loaded.result) return { title: "Session not found" };
  const { session } = loaded.result.data;
  const opensOnResults = !session.active_run && session.last_completed_run != null;
  return {
    title: `${opensOnResults ? "Session complete" : session.mode_label} · ${session.course_name}`,
  };
}

/**
 * /s/[sessionId]: one study session, for its owner only. Anyone else sees
 * the same "Session not found" as for a missing session, so links can't be
 * probed. The URL is in calendar events and must not change.
 *
 * Ownership is checked before anything streams, so a missing or foreign
 * session answers with a real 404. That is also why this segment has no
 * loading.tsx: its boundary would flush a 200 first. The skeleton comes from
 * the Suspense boundary below instead, after the check.
 */
export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;
  const userId = await getCurrentUserId();
  if (!userId) {
    redirect(`/auth/signin?callbackUrl=${encodeURIComponent(`/s/${sessionId}`)}`);
  }
  if (!(await isSessionOwner(userId, sessionId))) notFound();

  return (
    <Suspense fallback={<PreflightSkeleton />}>
      <SessionContent sessionId={sessionId} />
    </Suspense>
  );
}

async function SessionContent({ sessionId }: { sessionId: string }) {
  const loaded = await loadSessionScreen(sessionId);
  // Deleted between the check and this load
  if (loaded.signedOut || "error" in loaded.result) notFound();

  const { session, deckPreview, results } = loaded.result.data;
  return <SessionRunner session={session} deckPreview={deckPreview} initialResults={results} />;
}
