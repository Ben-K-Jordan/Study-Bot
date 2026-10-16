"use client"

import { useState } from "react"
import { ChevronDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/**
 * A text-button toggle that shows or hides extra detail, such as a chart's
 * data as a table. Same look as Plan's "Show earlier sessions": a chevron
 * that turns when open, and a label that says what the click does next.
 */
export function Disclosure({
  showLabel,
  hideLabel,
  className,
  children,
}: {
  /** Label while closed: "Show the weeks as a table". */
  showLabel: string
  /** Label while open: "Hide the table". */
  hideLabel: string
  className?: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("flex flex-col gap-2", className)}>
      <CollapsibleTrigger asChild>
        <Button variant="text" size="sm" className="group/disclosure self-start">
          <ChevronDownIcon
            data-icon="inline-start"
            aria-hidden="true"
            className="transition-transform duration-150 ease-standard group-data-[state=open]/disclosure:rotate-180"
          />
          {open ? hideLabel : showLabel}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  )
}
