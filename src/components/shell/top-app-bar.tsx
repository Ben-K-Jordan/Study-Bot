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
 *
 * The bar is fixed over the content column (AppShell pads the column by
 * --app-bar-height). In short windows it sits at the top of the page and
 * scrolls away with it, so it never covers the content or a focused
 * control. Its title starts where PageContainer's content starts: the
 * same gutters, plus half of whatever the column has beyond 80rem.
 * Printing (a study guide) leaves the bars out, since fixed elements
 * repeat on every printed page.
 */
export function TopAppBar({ account }: { account: Account }) {
  const pathname = usePathname()
  const override = useAppBarTitleOverride()
  const title = override ?? titleFor(pathname)

  return (
    <ViewTransition enter="shell-bar-recede" exit="shell-bar-recede" default="none">
      <header className="fixed inset-x-0 top-0 z-20 h-(--app-bar-height) bg-surface sm:left-(--rail-width) short:absolute print:hidden">
        <div className="flex h-full items-center gap-3 px-4 sm:px-6 md:pr-8 md:pl-[calc(max(0px,calc((100%_-_80rem)/2))_+_2rem)]">
          <AppMark className="size-8 sm:hidden" />
          <h1 className="min-w-0 flex-1 truncate type-title-l text-on-surface">{title}</h1>
          <div className="flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <AccountMenu account={account} />
          </div>
        </div>
      </header>
    </ViewTransition>
  )
}
