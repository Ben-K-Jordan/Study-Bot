"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { PlayIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

export interface SessionFabProps {
  /** The session page: /s/{sessionId}. */
  href: string
  /** True when the session is already under way, so the action resumes it. */
  resume: boolean
  /** "rail" sits under the app mark; "floating" sits above the bottom bar on compact windows. */
  placement: "rail" | "floating"
}

/**
 * Pages with their own primary action, where the floating button would
 * compete with it or sit on top of the form: Home's Today card holds the
 * same action in that corner, Study has its own Start session for the mode
 * it sets up, New plan and Materials are forms whose fields run under that
 * corner, Chat's composer is pinned to the bottom of the screen, and
 * Settings pins its save bar there once a setting changes. Wide windows
 * keep the button in the rail on every page.
 */
const OWN_PRIMARY_ACTION = ["/learn", "/plan/new", "/plan/materials", "/chat", "/settings"] as const

export function showsFloatingFab(pathname: string): boolean {
  const covers = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  return pathname !== "/" && !OWN_PRIMARY_ACTION.some(covers)
}

/** "Resume session" for one under way, else "Start today's session". */
export function sessionFabLabel(resume: boolean): string {
  return resume ? "Resume session" : "Start today's session"
}

/**
 * M3 floating action button for the one thing the student should do next:
 * start (or resume) today's session. It keeps that one step from every
 * screen in the shell: in the navigation rail from 600px, and above the
 * bottom bar on phones, like Gmail's Compose. In short windows (400% zoom)
 * the floating one steps aside, since it would cover a third of the page;
 * Home's Today card and the Plan rows still offer the session there.
 */
export function SessionFab({ href, resume, placement }: SessionFabProps) {
  const pathname = usePathname()
  const label = sessionFabLabel(resume)
  if (placement === "floating" && !showsFloatingFab(pathname)) return null
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          data-slot="session-fab"
          data-placement={placement}
          className={cn(
            "state-layer relative isolate flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary-container text-on-primary-container transition-shadow duration-150 ease-standard",
            placement === "rail"
              ? "mb-3 hover:shadow-sm"
              : "fixed right-4 bottom-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom)+1rem)] z-30 shadow-md hover:shadow-lg sm:hidden short:hidden print:hidden"
          )}
        >
          <PlayIcon className="size-6" strokeWidth={2.25} aria-hidden="true" />
        </Link>
      </TooltipTrigger>
      <TooltipContent side={placement === "rail" ? "right" : "top"}>{label}</TooltipContent>
    </Tooltip>
  )
}
