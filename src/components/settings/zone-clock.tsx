"use client"

import { useEffect, useState } from "react"

import { formatDateTime } from "@/lib/format"
import { useMounted } from "@/hooks/use-mounted"

/**
 * "Now in this time zone: Wed, Oct 15 at 2:14 PM". Ticks once a minute,
 * on the minute, and only re-renders itself. Deliberately not a live
 * region: a clock read aloud every minute is noise.
 */
export function ZoneClock({ timeZone, id }: { timeZone: string; id?: string }) {
  const mounted = useMounted()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    const tick = () => setNow(new Date())
    const toNextMinute = 60_000 - (Date.now() % 60_000)
    const timeout = setTimeout(() => {
      tick()
      interval = setInterval(tick, 60_000)
    }, toNextMinute)
    return () => {
      clearTimeout(timeout)
      if (interval) clearInterval(interval)
    }
  }, [])

  let text: string | null = null
  if (mounted) {
    try {
      text = `Now in this time zone: ${formatDateTime(now, { timeZone })}`
    } catch {
      text = null
    }
  }

  return (
    <p id={id} className="min-h-5 type-body-m text-on-surface-variant tabular-nums">
      {text ?? <span aria-hidden="true">&nbsp;</span>}
    </p>
  )
}
