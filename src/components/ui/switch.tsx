"use client"

import * as React from "react"
import { cn } from "cn"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full border-2 transition-colors duration-150 ease-standard outline-none after:absolute after:-inset-x-1 after:-inset-y-2 aria-invalid:border-destructive data-[size=default]:h-8 data-[size=default]:w-[52px] data-[size=sm]:h-6 data-[size=sm]:w-10 data-checked:border-primary data-checked:bg-primary data-unchecked:border-outline data-unchecked:bg-surface-container-highest data-disabled:cursor-not-allowed data-disabled:opacity-38 forced-colors:data-checked:border-[Highlight]",
        className
      )}
      {...props}
    >
      {/* In forced colours the thumb is drawn in system colours, so its
          size, side and colour still show whether the switch is on. */}
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className="pointer-events-none block rounded-full ring-0 transition-[translate,width,height,background-color] duration-150 ease-standard data-checked:bg-primary-foreground data-unchecked:bg-outline group-data-[size=default]/switch:data-unchecked:size-4 group-data-[size=default]/switch:data-unchecked:translate-x-[6px] group-data-[size=default]/switch:data-checked:size-6 group-data-[size=default]/switch:data-checked:translate-x-[22px] group-data-[size=sm]/switch:data-unchecked:size-3 group-data-[size=sm]/switch:data-unchecked:translate-x-1 group-data-[size=sm]/switch:data-checked:size-4 group-data-[size=sm]/switch:data-checked:translate-x-[18px] forced-colors:bg-[CanvasText] forced-colors:data-checked:bg-[Highlight]"
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
