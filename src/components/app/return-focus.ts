/**
 * Where focus goes when a dialog closes. Radix returns focus only to its own
 * trigger, so a dialog opened from a menu item or a row button (controlled,
 * with no trigger) would otherwise drop focus on <body> (WCAG 2.4.3).
 * Pure helpers, typed structurally so they can be tested without a DOM.
 */

/** The parts of an element these helpers use. */
export interface FocusTarget {
  isConnected: boolean
  focus(): void
  closest(selector: string): { getAttribute(name: string): string | null } | null
}

/**
 * The element to return focus to, read while the dialog opens: the focused
 * element itself, or for an item in a menu (which unmounts as the dialog
 * opens) the button that opened the menu. Radix labels a menu by its
 * trigger's id. Null when nothing useful had focus.
 */
export function resolveOpener<T extends FocusTarget>(
  active: T | null,
  body: unknown,
  getById: (id: string) => T | null
): T | null {
  if (!active || active === body) return null
  const triggerId = active.closest("[role='menu']")?.getAttribute("aria-labelledby")
  const trigger = triggerId ? getById(triggerId) : null
  return trigger ?? active
}

/**
 * Where focus may go when a confirmation dialog closes, best first. After the
 * action ran, `afterAction` wins: the opener is usually what was just
 * deleted, even if it hasn't left the page yet. After Cancel or Escape, the
 * opener does. The main region is the last resort, never <body>.
 */
export function closeFocusOrder<T>(input: {
  confirmed: boolean
  opener: T | null | undefined
  afterAction: T | null | undefined
  main: T | null | undefined
}): (T | null | undefined)[] {
  const { confirmed, opener, afterAction, main } = input
  return confirmed ? [afterAction, opener, main] : [opener, afterAction, main]
}

/** The first candidate still on the page, in priority order. */
export function firstConnected<T extends Pick<FocusTarget, "isConnected">>(
  candidates: readonly (T | null | undefined)[]
): T | null {
  return candidates.find((el): el is T => !!el && el.isConnected) ?? null
}
