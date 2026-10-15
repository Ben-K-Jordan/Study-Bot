"use client";

import { useEffect } from "react";

/**
 * Sets the tab title for the screen on view ("Session complete · CS 2110 ·
 * Study Bot"). The session layout's metadata gives the first paint; this
 * keeps the title in step as the student moves between screens.
 */
export function useDocumentTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}

/** "{parts} · Study Bot", skipping empty parts. */
export function sessionTitle(...parts: (string | null | undefined | false)[]): string {
  return [...parts.filter((p): p is string => Boolean(p)), "Study Bot"].join(" · ");
}
