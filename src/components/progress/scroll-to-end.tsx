"use client"

import { useLayoutEffect, useRef } from "react"

import { cn } from "@/lib/utils"

/**
 * A horizontal scroller that opens at its right end, so on a narrow screen
 * the heatmap shows the recent weeks first. Keyboard users can focus it and
 * scroll with the arrow keys.
 */
export function ScrollToEnd({
  label,
  className,
  children,
}: {
  /** Accessible name for the scrollable region. */
  label: string
  className?: string
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (el) el.scrollLeft = el.scrollWidth
  }, [])
  return (
    <div
      ref={ref}
      role="region"
      aria-label={label}
      tabIndex={0}
      className={cn("overflow-x-auto rounded-md pb-2 [--focus-ring-offset:-2px]", className)}
    >
      {children}
    </div>
  )
}
