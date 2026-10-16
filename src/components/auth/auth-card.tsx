"use client"

import { useEffect } from "react"

import { AppMark } from "@/components/shell/app-mark"
import { TITLE_TEMPLATE } from "@/lib/metadata"
import { cn } from "@/lib/utils"

export const AUTH_TITLE_ID = "auth-title"

/**
 * Keep the tab title on the card's h1 ("Check your email · Study Bot").
 * The page's metadata gives the first paint; this follows the views a form
 * switches to after an action (Password updated, a link that turned out to
 * be used), which metadata never sees. Screen readers read the title first.
 */
function useTabTitle(title: string) {
  useEffect(() => {
    document.title = TITLE_TEMPLATE.replace("%s", title)
  }, [title])
}

/**
 * The one card on every auth screen, after Google's sign-in: the Study Bot
 * mark, the page's h1 and a sentence on the left; the form or actions on
 * the right. One column under 840px, and edge to edge under 600px, where the
 * page itself is the card.
 */
export function AuthCard({
  title,
  description,
  children,
  headingRef,
  className,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  /** Pass `focusOnMount` when this view replaced another after an action. */
  headingRef?: React.Ref<HTMLHeadingElement>
  className?: string
}) {
  useTabTitle(title)
  return (
    <section
      aria-labelledby={AUTH_TITLE_ID}
      className={cn(
        "flex w-full flex-col bg-card px-6 pt-10 pb-8 text-card-foreground sm:rounded-4xl sm:p-10 md:px-10 md:py-9",
        className
      )}
    >
      <div className="grid grid-cols-1 gap-y-6 md:min-h-72 md:grid-cols-2 md:grid-rows-[auto_1fr] md:gap-x-12">
        <AppMark className="size-12" />
        <div className="flex min-w-0 flex-col gap-4 md:col-start-1 md:row-start-2">
          <h1
            id={AUTH_TITLE_ID}
            ref={headingRef}
            tabIndex={-1}
            className="type-headline-m text-balance text-on-surface focus:outline-none md:type-display-s"
          >
            {title}
          </h1>
          {description ? (
            <p className="type-body-l text-pretty text-on-surface-variant">{description}</p>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-col gap-8 md:col-start-2 md:row-start-2">{children}</div>
      </div>
    </section>
  )
}

/**
 * The action row at the end of the card: the alternative as a text button,
 * then the one filled button, right-aligned as on Google's sign-in.
 */
export function AuthActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-end gap-x-2 gap-y-3", className)}>
      {children}
    </div>
  )
}

/** Inline emphasis for an email address. Long addresses wrap anywhere instead of overflowing. */
export function EmailAddress({ children, className }: { children: string; className?: string }) {
  return <span className={cn("font-medium wrap-anywhere text-on-surface", className)}>{children}</span>
}

/**
 * A stable ref callback that focuses the element when it mounts. Use it for
 * a heading or summary that appears after an action, and give that element
 * a `key` that changes when it should take focus again.
 */
export function focusOnMount(node: HTMLElement | null) {
  node?.focus()
}
