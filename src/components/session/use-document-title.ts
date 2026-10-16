"use client";

import { useLayoutEffect } from "react";

/** Mounted titles, latest last. Only the latest writes, so two can never trade writes forever. */
const owners: symbol[] = [];

/**
 * Sets the tab title for the screen on view ("Session complete · CS 2110 ·
 * Study Bot") and keeps it there while the screen is mounted. Pass null to
 * leave the title to a screen inside.
 *
 * The page's metadata gives the first paint, but Next streams that metadata:
 * on a client-side navigation, and again on the router.refresh() after a
 * session finishes, the old <title> goes before the new one arrives. Writing
 * the title once would leave the tab blank in between (and screen readers
 * with nothing to name), so the title is written again whenever <head>
 * changes and the tab no longer says it.
 *
 * Writing to document.title adds a <title> when there is none; React adopts
 * that element for the next metadata title, so none is left behind. The
 * observer stops in a layout effect's cleanup, inside the same commit that
 * unmounts the screen, so it never writes over the next page's title.
 */
export function useDocumentTitle(title: string | null) {
  useLayoutEffect(() => {
    if (!title) return;
    const self = Symbol(title);
    owners.push(self);
    const apply = () => {
      if (owners[owners.length - 1] === self && document.title !== title) document.title = title;
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      owners.splice(owners.indexOf(self), 1);
    };
  }, [title]);
}

/** "{parts} · Study Bot", skipping empty parts. */
export function sessionTitle(...parts: (string | null | undefined | false)[]): string {
  return [...parts.filter((p): p is string => Boolean(p)), "Study Bot"].join(" · ");
}
