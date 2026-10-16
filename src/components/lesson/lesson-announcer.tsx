"use client"

import * as React from "react"

type Announce = (message: string) => void

const AnnouncerContext = React.createContext<Announce | null>(null)

/**
 * A polite live region that stays mounted for the whole lesson, so status
 * messages ("Correct", "Answer saved") are announced reliably. LessonFrame
 * provides it; primitives call useLessonAnnounce().
 */
export function LessonAnnouncer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState("")
  const frame = React.useRef<number | null>(null)

  const announce = React.useCallback<Announce>((next) => {
    // Clear first so the same message twice in a row is still announced.
    setMessage("")
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => setMessage(next))
  }, [])

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    []
  )

  return (
    <AnnouncerContext.Provider value={announce}>
      {children}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </p>
    </AnnouncerContext.Provider>
  )
}

/** Announces a status message inside LessonFrame; null outside it. */
export function useLessonAnnounce(): Announce | null {
  return React.useContext(AnnouncerContext)
}
