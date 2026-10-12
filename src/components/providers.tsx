"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"
import { SWRConfig } from "swr"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { swrConfig } from "@/lib/swr"

/**
 * App-wide client providers: theme (light, dark or system), the next-auth
 * session for the account menu, SWR defaults, tooltip timing, and the toast
 * region.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <SessionProvider refetchOnWindowFocus={false}>
        <SWRConfig value={swrConfig}>
          <TooltipProvider>
            {children}
            <Toaster
              position="bottom-center"
              mobileOffset={{ bottom: "calc(var(--bottom-bar-height) + 1rem)" }}
            />
          </TooltipProvider>
        </SWRConfig>
      </SessionProvider>
    </ThemeProvider>
  )
}
