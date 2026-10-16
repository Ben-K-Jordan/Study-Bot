"use client"

import * as React from "react"
import { KeyboardIcon } from "lucide-react"

import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

const ROWS: { keys: readonly string[]; label: string }[] = [
  { keys: ["Space"], label: "Show answer" },
  { keys: ["1", "2", "3", "4"], label: "Rate the card Again, Hard, Good, or Easy" },
]

/**
 * The review's keyboard shortcuts, one button away in the top bar. The
 * number keys can be turned off here (WCAG 2.1.4); the setting is the same
 * one study sessions use. Hidden on touch screens, where there is no keyboard.
 */
export function ReviewKeyboardHelp({
  shortcutsEnabled,
  onShortcutsEnabledChange,
}: {
  shortcutsEnabled: boolean
  onShortcutsEnabledChange: (enabled: boolean) => void
}) {
  const titleId = React.useId()
  const switchId = React.useId()
  const helpId = React.useId()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-lesson-muted transition-colors hover:bg-lesson-option-hover hover:text-lesson-on-surface pointer-coarse:hidden"
        >
          <KeyboardIcon aria-hidden="true" className="size-6" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="bottom" className="w-80" aria-labelledby={titleId}>
        <h2 id={titleId} className="type-title-m">
          Keyboard shortcuts
        </h2>
        <dl className="flex flex-col gap-2.5">
          {ROWS.map((row) => (
            <div key={row.label} className="flex items-start justify-between gap-4">
              <dt className="order-2 shrink-0">
                <KbdGroup>
                  {row.keys.map((key) => (
                    <Kbd key={key}>{key}</Kbd>
                  ))}
                </KbdGroup>
              </dt>
              <dd className="order-1 type-body-m text-on-surface-variant">{row.label}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <label htmlFor={switchId} className="type-label-l">
              Single-key shortcuts
            </label>
            <p id={helpId} className="type-body-s text-on-surface-variant">
              The same setting applies in study sessions.
            </p>
          </div>
          <Switch
            id={switchId}
            aria-describedby={helpId}
            checked={shortcutsEnabled}
            onCheckedChange={onShortcutsEnabledChange}
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
