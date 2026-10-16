"use client"

import { useSyncExternalStore } from "react"

const subscribe = () => () => {}

/**
 * False during server rendering and hydration, true afterwards. Use it to
 * render values only the browser knows (the stored theme, the time zone)
 * without a hydration mismatch.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}
