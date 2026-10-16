"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useMounted } from "@/hooks/use-mounted"

const THEMES = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
] as const

type ThemeValue = (typeof THEMES)[number]["value"]

function isThemeValue(value: string): value is ThemeValue {
  return THEMES.some((t) => t.value === value)
}

/**
 * Light, dark or system theme. `menu` is an icon button for the top app
 * bar; `segmented` is a three-way control for Settings and the More sheet.
 */
export function ThemeToggle({
  variant = "menu",
}: {
  variant?: "menu" | "segmented"
}) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const mounted = useMounted()
  const current: ThemeValue = mounted && theme && isThemeValue(theme) ? theme : "system"

  if (variant === "segmented") {
    return (
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        value={current}
        onValueChange={(value) => {
          if (value && isThemeValue(value)) setTheme(value)
        }}
        aria-label="Theme"
      >
        {THEMES.map(({ value, label, icon: Icon }) => (
          <ToggleGroupItem key={value} value={value}>
            <Icon data-icon="inline-start" aria-hidden="true" />
            {label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    )
  }

  // The trigger shows the theme in effect, so "System" on a dark OS shows a moon.
  const TriggerIcon = !mounted ? SunIcon : resolvedTheme === "dark" ? MoonIcon : SunIcon

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Change theme">
              <TriggerIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Theme</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={current}
            onValueChange={(value) => {
              if (isThemeValue(value)) setTheme(value)
            }}
          >
            {THEMES.map(({ value, label, icon: Icon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <Icon aria-hidden="true" />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
