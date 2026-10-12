"use client"

import { usePathname } from "next/navigation"

import { AppMark } from "@/components/shell/app-mark"
import { NavDestination } from "@/components/shell/nav-link"
import { NAV_ITEMS, SETTINGS_ITEM, isActivePath } from "@/components/shell/nav-items"

/**
 * M3 navigation rail for medium and wider windows (600px and up): the app
 * mark on top, the seven destinations, and Settings at the bottom.
 */
export function NavigationRail() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Main"
      className="fixed inset-y-0 left-0 z-30 hidden w-(--rail-width) flex-col items-center bg-surface pb-4 sm:flex"
    >
      <div className="flex h-(--app-bar-height) shrink-0 items-center justify-center">
        <AppMark className="size-9" />
      </div>
      <ul className="flex w-full flex-1 flex-col items-center gap-3 overflow-y-auto px-2 pt-1 pb-4 no-scrollbar">
        {NAV_ITEMS.map((item) => (
          <li key={item.href} className="w-full">
            <NavDestination item={item} active={isActivePath(pathname, item.href)} />
          </li>
        ))}
      </ul>
      <div className="w-full shrink-0 px-2">
        <NavDestination item={SETTINGS_ITEM} active={isActivePath(pathname, SETTINGS_ITEM.href)} />
      </div>
    </nav>
  )
}
