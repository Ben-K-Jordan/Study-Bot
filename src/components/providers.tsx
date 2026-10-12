"use client"

import { SessionProvider } from "next-auth/react"
import { ThemeProvider } from "next-themes"

import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"

/**
 * App-wide client providers: theme (light, dark or system), the next-auth
 * session for the account menu, tooltip timing, and the toast region.
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
        <TooltipProvider>
          {children}
          <Toaster
            position="bottom-center"
            mobileOffset={{ bottom: "calc(var(--bottom-bar-height) + 1rem)" }}
          />
        </TooltipProvider>
      </SessionProvider>
    </ThemeProvider>
  )
}
