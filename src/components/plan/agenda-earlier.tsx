"use client"

import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { plural } from "@/lib/format"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"

/** Folds the finished days at the top of the agenda behind one toggle. */
export function AgendaEarlier({ count, children }: { count: number; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger asChild>
        <Button
          variant="text"
          size="sm"
          className="group/earlier self-start"
        >
          <ChevronDownIcon
            data-icon="inline-start"
            aria-hidden="true"
            className="transition-transform duration-150 ease-standard group-data-[state=open]/earlier:rotate-180"
          />
          {open
            ? "Hide earlier sessions"
            : plural(count, { one: "Show # earlier session", other: "Show # earlier sessions" })}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-b border-outline-variant">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}
