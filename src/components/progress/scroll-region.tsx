"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

/**
 * Holds content that can outgrow its box: a table wider than a narrow phone,
 * or a list taller than its `max-h-*`. When the content overflows, the
 * wrapper scrolls and becomes a labelled, focusable region, so keyboard
 * users can reach the hidden part with the arrow keys. When it fits, it adds
 * no tab stop and no landmark.
 *
 * The shadcn Table brings its own scroll container; this one takes over, so
 * the scroller is always the focusable element.
 */
export function ScrollRegion({
  label,
  className,
  children,
}: {
  /** Accessible name while the region scrolls: "Rated questions by how sure you were". */
  label: string
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrolls, setScrolls] = useState(false)

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
