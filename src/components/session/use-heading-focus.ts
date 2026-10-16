"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";

const subscribe = () => () => {};

/** True while React hydrates server-rendered HTML, false for anything rendered on the client. */
function useHydrating(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => false,
    () => true
  );
}

/**
 * Moves focus to a session screen's heading (it needs tabIndex={-1}), so a
 * screen reader names the screen and Tab continues from it:
 * - when the screen replaces another inside the session (`moveFocus`, say
 *   after the last question or Start session again), and
 * - when a client-side navigation opened the session and left focus on
 *   <body>. Next announces a new page by its title or its first h1, but the
 *   session's title is still streaming at that moment and its skeleton has
 *   no h1, so nothing would be said.
 * A full page load keeps the browser's own start: focus on the document, so
 * the first Tab still reaches the skip link.
 *
 * `key` names the heading element when it can change while the screen stays
 * mounted (results that turn out empty swap it); focus follows to the new
 * heading only when it was lost with the old one.
 */
export function useHeadingFocus(ref: RefObject<HTMLElement | null>, moveFocus: boolean, key?: unknown) {
  const hydrating = useHydrating();
  // Fixed at the first render: hydrated with the page, or rendered after a navigation.
  const [openedByNavigation] = useState(!hydrating);
  const moved = useRef(false);

  useEffect(() => {
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if ((moveFocus && !moved.current) || ((moveFocus || openedByNavigation) && lost)) {
      ref.current?.focus({ preventScroll: !moveFocus });
    }
    moved.current = moveFocus;
  }, [ref, moveFocus, openedByNavigation, key]);
}
