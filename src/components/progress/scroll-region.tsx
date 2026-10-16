"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Holds content that can outgrow its box: a table wider than a narrow phone,
 * a list taller than its `max-h-*`, or the year-long heatmap. When the
 * content overflows, the wrapper scrolls and becomes a labelled, focusable
 * region, so keyboard users can reach the hidden part with the arrow keys.
 * When it fits, it adds no tab stop and no landmark.
 *
 * The shadcn Table brings its own scroll container; this one takes over, so
 * the scroller is always the focusable element.
 */
export function ScrollRegion({
  label,
  describedBy,
  startAtEnd = false,
  className,
  children,
}: {
  /** Accessible name while the region scrolls: "Rated questions by how sure you were". */
  label: string
  /**
   * Ids of visible text that says what the region holds, read when it takes
   * focus. Needed when the content itself is hidden from assistive technology.
   */
  describedBy?: string
  /** Open scrolled to the right end, so a timeline shows its newest part first. */
  startAtEnd?: boolean
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Until it is measured (server HTML, before hydration), assume it scrolls:
  // a labelled tab stop that turns out to fit is harmless for a moment, but
  // a scroller with no tab stop can't be reached by keyboard at all.
  const [scrolls, setScrolls] = useState(true)

  // Before paint, so a narrow screen never flashes the oldest weeks first.
  useLayoutEffect(() => {
    const el = ref.current
    if (el && startAtEnd) el.scrollLeft = el.scrollWidth
  }, [startAtEnd])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () =>
      setScrolls(el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    check()
    const observer = new ResizeObserver(check)
    observer.observe(el)
    for (const child of [el.firstElementChild, el.querySelector("table")]) {
      if (child) observer.observe(child)
    }
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      role={scrolls ? "region" : undefined}
      aria-label={scrolls ? label : undefined}
      aria-describedby={scrolls ? describedBy : undefined}
      tabIndex={scrolls ? 0 : undefined}
      className={cn(
        "overflow-auto rounded-md [--focus-ring-offset:-2px] [&>[data-slot=table-container]]:overflow-visible",
        className
      )}
    >
      {children}
    </div>
  )
}
