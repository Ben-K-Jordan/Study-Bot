"use client"

import * as React from "react"
import { KeyboardIcon } from "lucide-react"

import { useModKey } from "@/components/app/kbd-hint"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

import { HOTKEY_HELP } from "./hotkeys"

/**
 * The session's keyboard shortcuts, one button away (or "?"). Single-key
 * shortcuts can be turned off here (WCAG 2.1.4); Ctrl or Cmd with Enter
 * always works. Hidden on touch screens, where there is no keyboard.
 */
export function KeyboardHelp({
  open,
  onOpenChange,
  shortcutsEnabled,
  onShortcutsEnabledChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  shortcutsEnabled: boolean
  onShortcutsEnabledChange: (enabled: boolean) => void
}) {
  const mod = useModKey()
  const titleId = React.useId()
  const switchId = React.useId()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          className="flex size-11 shrink-0 items-center justify-center self-start rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface pointer-coarse:hidden sm:self-center"
        >
          <KeyboardIcon aria-hidden="true" className="size-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="top" className="w-80" aria-labelledby={titleId}>
        <h2 id={titleId} className="type-title-m">
          Keyboard shortcuts
        </h2>
        <dl className="flex flex-col gap-2.5">
          {HOTKEY_HELP.map((row) => (
            <div key={`${row.keys.join("+")}-${row.label}`} className="flex items-start justify-between gap-4">
              <dt className="order-2 shrink-0">
                <KbdGroup>
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key === "Mod" ? mod : key}</Kbd>
                  ))}
                </KbdGroup>
              </dt>
              <dd className="order-1 type-body-m text-on-surface-variant">{row.label}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={switchId} className="type-label-l">
            Single-key shortcuts
          </label>
          <Switch id={switchId} checked={shortcutsEnabled} onCheckedChange={onShortcutsEnabledChange} />
        </div>
      </PopoverContent>
    </Popover>
  )
}
