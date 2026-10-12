"use client"

import Link from "next/link"

import { cn } from "@/lib/utils"
import type { NavItem } from "@/components/shell/nav-items"

/**
 * One destination in the navigation rail or the bottom navigation bar:
 * icon in a pill-shaped active indicator, label underneath (M3).
 */
export function NavDestination({
  item,
  active,
  onNavigate,
  className,
}: {
  item: NavItem
  active: boolean
  onNavigate?: () => void
  className?: string
}) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group/nav flex min-h-14 flex-col items-center justify-center gap-1 rounded-2xl text-on-surface-variant outline-none [--focus-ring-offset:-2px]",
        className
      )}
    >
      <span
        className={cn(
          "relative isolate flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ease-standard",
          // State layer for the whole destination, drawn on the indicator
          "before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity group-hover/nav:before:opacity-8 group-focus-visible/nav:before:opacity-10 group-active/nav:before:opacity-10",
          active
            ? "bg-secondary-container text-on-secondary-container"
            : "group-hover/nav:text-on-surface"
        )}
      >
        <Icon className="size-6" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
      </span>
      <span
        className={cn(
          "type-label-m",
          active ? "text-on-surface" : "group-hover/nav:text-on-surface"
        )}
      >
        {item.label}
      </span>
    </Link>
  )
}
