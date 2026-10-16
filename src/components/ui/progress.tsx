"use client"

import * as React from "react"
import { cn } from "cn"
import { Progress as ProgressPrimitive } from "radix-ui"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        // In forced colours the track is outlined and the fill drawn in a
        // system colour, since both backgrounds would otherwise disappear.
        "relative flex h-1 w-full items-center overflow-x-hidden rounded-full bg-secondary-container forced-colors:outline-1 forced-colors:outline-[CanvasText]",
        className
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="size-full flex-1 rounded-full bg-primary transition-transform duration-250 ease-standard forced-colors:bg-[CanvasText]"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
