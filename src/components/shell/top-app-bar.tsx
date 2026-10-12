"use client"

import { usePathname } from "next/navigation"

import { AccountMenu } from "@/components/app/account-menu"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { AppMark } from "@/components/shell/app-mark"
import { useAppBarTitleOverride } from "@/components/shell/app-bar-title"
import { navItemFor } from "@/components/shell/nav-items"

/**
 * M3 small top app bar. The title is the page's h1: the destination name by
 * default, or whatever the page sets with useAppBarTitle / <AppBarTitle>.
 */
export function TopAppBar() {
  const pathname = usePathname()
  const override = useAppBarTitleOverride()
  const title = override ?? navItemFor(pathname)?.title ?? "Study Bot"

  return (
    <header className="sticky top-0 z-20 flex h-(--app-bar-height) shrink-0 items-center gap-3 bg-surface px-4 sm:px-6">
      <AppMark className="size-8 sm:hidden" />
      <h1 className="min-w-0 flex-1 truncate type-title-l text-on-surface">{title}</h1>
      <div className="flex shrink-0 items-center gap-1">
        <ThemeToggle />
        <AccountMenu />
      </div>
    </header>
  )
}
