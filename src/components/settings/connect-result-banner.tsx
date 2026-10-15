"use client"

import { useEffect, useRef, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { GoogleConnectResult } from "@/lib/google/messages"

/**
 * The outcome of Google's OAuth flow, shown at the top of Settings when the
 * callback lands on /settings?google=connected (or =error&reason=…). The
 * query is removed from the address bar so a reload doesn't repeat it, and
 * focus moves here so the result is read out first.
 */
export function ConnectResultBanner({ result }: { result: GoogleConnectResult }) {
  const [dismissed, setDismissed] = useState(false)
  const titleRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete("google")
    url.searchParams.delete("reason")
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`)
    titleRef.current?.focus()
  }, [])

  if (dismissed) return null

  const success = result.tone === "success"
  const Icon = success ? CircleCheckIcon : CircleAlertIcon

  return (
    <Alert variant={success ? "success" : "destructive"} role={success ? "status" : "alert"}>
      <Icon aria-hidden="true" />
      <AlertTitle ref={titleRef} tabIndex={-1} className="outline-none">
        {result.title}
      </AlertTitle>
      <AlertDescription>
        <p>{result.description}</p>
        <div className="-ml-3 pt-1">
          <Button type="button" variant="text" size="sm" className="text-current" onClick={() => {
              setDismissed(true)
              // The banner held focus; hand it to the page instead of the document body.
              document.getElementById("main-content")?.focus()
            }}>
            Dismiss
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  )
}
