"use client"

import * as React from "react"
import { ViewTransition } from "react"
import { usePathname } from "next/navigation"
import { EllipsisIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { NavDestination } from "@/components/shell/nav-link"
import { NAV_ITEMS, SETTINGS_ITEM, isActivePath } from "@/components/shell/nav-items"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Separator } from "@/components/ui/separator"

const PRIMARY = NAV_ITEMS.filter((item) => item.primary)
const OVERFLOW = [...NAV_ITEMS.filter((item) => !item.primary), SETTINGS_ITEM]

/**
 * M3 navigation bar for compact windows (under 600px): four destinations
 * plus More, which opens a bottom sheet with the rest and the theme.
 * Entering a session it slides down.
 */
export function BottomNav() {
  const pathname = usePathname()
  const [moreOpen, setMoreOpen] = React.useState(false)
  const moreActive = OVERFLOW.some((item) => isActivePath(pathname, item.href))

  return (
    <ViewTransition enter="shell-nav-recede" exit="shell-nav-recede" default="none">
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 bg-surface-container pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        <ul className="mx-auto grid h-(--bottom-bar-height) max-w-md grid-cols-5 items-center px-1">
          {PRIMARY.map((item) => (
            <li key={item.href}>
              <NavDestination item={item} active={isActivePath(pathname, item.href)} />
            </li>
          ))}
          <li>
            <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  aria-current={moreActive ? "page" : undefined}
                  className="group/nav flex min-h-14 w-full flex-col items-center justify-center gap-1 rounded-2xl text-on-surface-variant outline-none [--focus-ring-offset:-2px]"
                >
                  <span
                    className={cn(
                      "relative isolate flex h-8 w-14 items-center justify-center rounded-full transition-colors duration-150 ease-standard",
                      "before:absolute before:inset-0 before:-z-10 before:rounded-full before:bg-current before:opacity-0 before:transition-opacity group-hover/nav:before:opacity-8 group-focus-visible/nav:before:opacity-10 group-active/nav:before:opacity-10",
                      moreActive && "bg-secondary-container text-on-secondary-container"
                    )}
                  >
                    <EllipsisIcon className="size-6" aria-hidden="true" />
                  </span>
                  <span className={cn("type-label-m", moreActive && "text-on-surface")}>More</span>
                </button>
              </SheetTrigger>
              <SheetContent side="bottom" className="px-2 pb-6">
                <SheetHeader className="px-4 pt-6 pb-2">
                  <SheetTitle>More</SheetTitle>
                  <SheetDescription className="sr-only">
                    Other places in Study Bot, and the theme.
                  </SheetDescription>
                </SheetHeader>
                <ul className="grid grid-cols-4 gap-1 px-2">
                  {OVERFLOW.map((item) => (
                    <li key={item.href}>
                      <NavDestination
                        item={item}
                        active={isActivePath(pathname, item.href)}
                        onNavigate={() => setMoreOpen(false)}
                        className="min-h-18"
                      />
                    </li>
                  ))}
                </ul>
                <Separator className="my-4" />
                <div className="flex flex-col gap-3 px-4">
                  <p className="type-title-s text-on-surface-variant" aria-hidden="true">
                    Theme
                  </p>
                  <ThemeToggle variant="segmented" />
                </div>
              </SheetContent>
            </Sheet>
          </li>
        </ul>
      </nav>
    </ViewTransition>
  )
}
