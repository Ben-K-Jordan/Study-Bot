"use client"

import * as React from "react"
import { usePathname } from "next/navigation"

const STORAGE_KEY = "study-bot:session-refreshed-at"
const DAY_MS = 24 * 60 * 60 * 1000

function readLast(): number {
  try {
    return Number(window.localStorage.getItem(STORAGE_KEY)) || 0
  } catch {
    return 0
  }
}

function writeNow(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()))
  } catch {
    // Without storage the next page load refreshes again, which is harmless
  }
}

/**
 * Keeps an active student signed in. The sign-in cookie is a JWT that
 * next-auth reissues, with a fresh expiry, when /api/auth/session is read.
 * Nothing else reads it now that the account menu gets the student from the
 * server, so without this a session would end 7 days after sign-in however
 * often the student studies. It also clears the cookie of a session that was
 * ended (password reset, deleted account).
 *
 * It checks on every page the student opens, client navigations included,
 * and whenever the tab comes back into view, so one tab kept open for days
 * stays signed in too. At most one request a day per browser, and none on
 * the sign-in screens.
 */
export function SessionKeepAlive() {
  const pathname = usePathname()
  const onAuthScreen = pathname?.startsWith("/auth") ?? false

  React.useEffect(() => {
    if (onAuthScreen) return
    let controller: AbortController | null = null

    const refreshIfDue = () => {
      if (controller || Date.now() - readLast() < DAY_MS) return
      const current = new AbortController()
      controller = current
      fetch("/api/auth/session", { cache: "no-store", signal: current.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((session: { user?: unknown } | null) => {
          // Only a signed-in answer counts; signed out, the next check asks again
          if (session?.user) writeNow()
        })
        .catch(() => {})
        .finally(() => {
          if (controller === current) controller = null
        })
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfDue()
    }

    refreshIfDue()
    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      controller?.abort()
    }
  }, [onAuthScreen, pathname])

  return null
}
