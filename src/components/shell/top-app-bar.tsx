"use client"

import { ViewTransition } from "react"
import { usePathname } from "next/navigation"

import { AccountMenu, type Account } from "@/components/app/account-menu"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { AppMark } from "@/components/shell/app-mark"
import { useAppBarTitleOverride } from "@/components/shell/app-bar-title"
import { titleFor } from "@/components/shell/nav-items"

/**
 * M3 small top app bar. The title is the page's h1: the destination name,
 * or a more specific one from ROUTE_TITLES in nav-items.ts, both known on
 * the server. A page with a title only it knows can still set one with
 * useAppBarTitle or <AppBarTitle>. Entering a session the bar slides up.
 */
export function TopAppBar({ account }: { account: Account }) {
  const pathname = usePathname()
  const override = useAppBarTitleOverride()
  const title = override ?? titleFor(pathname)

  return (
    <ViewTransition enter="shell-bar-recede" exit="shell-bar-recede" default="none">
      <header className="sticky top-0 z-20 flex h-(--app-bar-height) shrink-0 items-center gap-3 bg-surface px-4 sm:px-6 short:static">
        <AppMark className="size-8 sm:hidden" />
        <h1 className="min-w-0 flex-1 truncate type-title-l text-on-surface">{title}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <AccountMenu account={account} />
        </div>
      </header>
    </ViewTransition>
  )
}
