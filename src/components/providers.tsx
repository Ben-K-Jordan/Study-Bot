"use client"

import { ThemeProvider } from "next-themes"
import { SWRConfig } from "swr"

import { SessionKeepAlive } from "@/components/app/session-keep-alive"
import { ThemeColorSync } from "@/components/app/theme-color-sync"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { swrConfig } from "@/lib/swr"

/**
 * App-wide client providers: theme (light, dark or system), SWR defaults,
 * tooltip timing, and the toast region. The account menu gets the signed-in
 * student from the (app) layout on the server, so no session provider runs
 * here; SessionKeepAlive renews the sign-in once a day instead.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <ThemeColorSync />
      <SessionKeepAlive />
      <SWRConfig value={swrConfig}>
        <TooltipProvider>
          {children}
          {/* Toasts stay 8 seconds (paused while hovered or focused) and can be
              dismissed; a toast that must not vanish passes its own duration. */}
          <Toaster
            position="bottom-center"
            duration={8000}
            closeButton
            mobileOffset={{ bottom: "calc(var(--bottom-bar-height) + 1rem)" }}
          />
        </TooltipProvider>
      </SWRConfig>
    </ThemeProvider>
  )
}
