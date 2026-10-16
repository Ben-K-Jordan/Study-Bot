"use client"

import * as React from "react"

type TitleContextValue = {
  title: string | null
  setTitle: (title: string | null) => void
}

const TitleContext = React.createContext<TitleContextValue | null>(null)

/** Holds the page title a page sets for the top app bar. */
export function AppBarTitleProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = React.useState<string | null>(null)
  const value = React.useMemo(() => ({ title, setTitle }), [title])
  return <TitleContext.Provider value={value}>{children}</TitleContext.Provider>
}

/** The title a page set, or null when the route default applies. */
export function useAppBarTitleOverride(): string | null {
  return React.useContext(TitleContext)?.title ?? null
}

/**
 * Sets the top app bar title while the calling page is mounted, for pages
 * whose heading is more specific than the destination name
 * ("Prelim 1 plan" instead of "Plan"). Pass null to keep the default.
 */
export function useAppBarTitle(title: string | null) {
  const setTitle = React.useContext(TitleContext)?.setTitle
  React.useEffect(() => {
    if (!setTitle) return
    setTitle(title)
    return () => setTitle(null)
  }, [setTitle, title])
}

/** Component form of useAppBarTitle, usable from a Server Component page. */
export function AppBarTitle({ children }: { children: string }) {
  useAppBarTitle(children)
  return null
}
