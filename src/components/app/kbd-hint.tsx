"use client"

import { cn } from "@/lib/utils"
import { useMounted } from "@/hooks/use-mounted"
import { Kbd, KbdGroup } from "@/components/ui/kbd"

/**
 * A keyboard hint ("1", "Enter", "Ctrl+Enter") drawn as keys. Decorative:
 * the control it sits in already has a name, so the hint is aria-hidden.
 * Hidden on touch screens, where there is no keyboard to press.
 */
export function KbdHint({
  keys,
  className,
}: {
  /** One key, or several pressed together ("Mod" becomes Ctrl or Cmd). */
  keys: string | readonly string[]
  className?: string
}) {
  const mod = useModKey()
  const list = (typeof keys === "string" ? [keys] : keys).map((k) => (k === "Mod" ? mod : k))
  return (
    <KbdGroup aria-hidden="true" className={cn("pointer-coarse:hidden", className)}>
      {list.map((key) => (
        <Kbd key={key}>{key}</Kbd>
      ))}
    </KbdGroup>
  )
}

/** "Cmd" on Apple devices, "Ctrl" elsewhere ("Ctrl" until hydrated). */
export function useModKey(): "Cmd" | "Ctrl" {
  const mounted = useMounted()
  if (!mounted) return "Ctrl"
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ""
  return /mac|iphone|ipad/i.test(platform) ? "Cmd" : "Ctrl"
}
