"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"

import { THEME_COLORS } from "@/components/shell/theme-colors"

/**
 * Keeps <meta name="theme-color"> in step with the theme toggle. The root
 * layout's pair follows prefers-color-scheme only, so a student who picks
 * Dark on a light system would get a light browser bar above a dark page.
 * With System chosen, the original pair applies again.
 */
export function ThemeColorSync() {
  const { theme } = useTheme()
  const pathname = usePathname()

  React.useEffect(() => {
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    for (const meta of metas) {
      meta.dataset.systemColor ??= meta.content
      meta.content =
        theme === "light" || theme === "dark" ? THEME_COLORS[theme] : meta.dataset.systemColor
    }
    // The pathname dependency re-applies the colour if navigation replaced the tags.
  }, [theme, pathname])

  return null
}
