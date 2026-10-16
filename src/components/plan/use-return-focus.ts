"use client"

import * as React from "react"

/** Focus the first candidate that is in the page and takes focus. */
function focusFirst(candidates: readonly (HTMLElement | null | undefined)[]): boolean {
  for (const element of candidates) {
    if (!element || !element.isConnected) continue
    element.focus()
    if (document.activeElement === element) return true
  }
  return false
}

function mainContent(): HTMLElement | null {
  return document.getElementById("main-content")
}

/** Where focus may go, best first: the opener, the fallback, the main region. */
function candidatesFor(
  opener: HTMLElement | null,
  fallback: React.RefObject<HTMLElement | null> | undefined
): (HTMLElement | null | undefined)[] {
  return [opener, fallback?.current, mainContent()]
}

/**
 * Where keyboard focus goes when a dialog that has no DialogTrigger closes.
 * Radix returns focus only to its own trigger, so a dialog opened from a
 * menu item, a row button or a deep link drops focus on <body> (WCAG 2.4.3).
 *
 * Call `remember(opener)` when opening the dialog and pass `onCloseAutoFocus`
 * to its DialogContent or AlertDialogContent. ConfirmDialog doesn't need
 * this hook: it returns focus itself (see its `returnFocus` prop). Focus goes to the opener when
 * it is still on the page, else to `fallback`, else to the main region.
 */
export function useReturnFocus(fallback?: React.RefObject<HTMLElement | null>) {
  const target = React.useRef<HTMLElement | null>(null)

  const remember = React.useCallback((element: HTMLElement | null) => {
    target.current = element
  }, [])

  const onCloseAutoFocus = React.useCallback(
    (event: Event) => {
      const candidates = candidatesFor(target.current, fallback)
      target.current = null
      // Only take over when something can take focus; otherwise Radix's default runs
      if (candidates.some((el) => el?.isConnected)) {
        event.preventDefault()
        focusFirst(candidates)
      }
    },
    [fallback]
  )

  return { remember, onCloseAutoFocus }
}

export type ReturnFocus = ReturnType<typeof useReturnFocus>
