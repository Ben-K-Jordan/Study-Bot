"use client";

import { useMounted } from "@/hooks/use-mounted";

/**
 * The time zone to format dates in: the student's zone from Settings when
 * the server knows it, otherwise the browser's. A browser-only zone is
 * unknown during server rendering, so `ready` stays false until hydration
 * and callers render the date after it (no hydration mismatch).
 */
export function useZone(timeZone: string | null): { timeZone: string | undefined; ready: boolean } {
  const mounted = useMounted();
  if (timeZone) return { timeZone, ready: true };
  return { timeZone: undefined, ready: mounted };
}
