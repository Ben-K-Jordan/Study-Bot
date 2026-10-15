"use client"

import { useEffect, useRef, useState } from "react"

import { cn } from "@/lib/utils"

export interface SettingsNavItem {
  id: string
  label: string
}

/**
 * The section list beside Settings on wide windows, like Google Calendar's
 * settings: in-page links, with the section in view marked as current.
 * Hidden under 840px, where the sections simply stack.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id ?? "")
  // A clicked link stays current while the jump's own scroll event fires.
  const pinnedUntil = useRef(0)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      if (performance.now() < pinnedUntil.current) return
      // The current section is the last one whose top has passed a line just under the app bar.
      const line = (document.querySelector("header")?.getBoundingClientRect().bottom ?? 64) + 96
      let current = items[0]?.id ?? ""
      for (const item of items) {
        const top = document.getElementById(item.id)?.getBoundingClientRect().top
        if (top !== undefined && top <= line) current = item.id
      }
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2
      if (atBottom && items.length > 0) current = items[items.length - 1].id
      setActive(current)
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    schedule()
    window.addEventListener("scroll", schedule, { passive: true })
    window.addEventListener("resize", schedule, { passive: true })
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener("scroll", schedule)
      window.removeEventListener("resize", schedule)
    }
  }, [items])

  return (
    <nav
      aria-label="Settings sections"
      className="hidden md:sticky md:top-[calc(var(--app-bar-height)+0.5rem)] md:block md:self-start"
    >
      <ul className="flex flex-col gap-1">
        {items.map((item) => {
          const current = item.id === active
          return (
            <li key={item.id}>
              <a
                href={`#${item.id}`}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  pinnedUntil.current = performance.now() + 600
                  setActive(item.id)
                }}
                className={cn(
                  "state-layer relative isolate flex h-12 items-center rounded-full px-4 type-label-l text-on-surface-variant transition-colors duration-150 ease-standard",
                  current && "bg-secondary-container text-on-secondary-container"
                )}
              >
                {item.label}
              </a>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
