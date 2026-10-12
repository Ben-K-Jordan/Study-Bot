"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn(
        "group/tabs flex min-w-0 gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-full items-stretch justify-start overflow-x-auto border-b border-border text-on-surface-variant no-scrollbar group-data-horizontal/tabs:h-12 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:border-r group-data-vertical/tabs:border-b-0",
  {
    variants: {
      variant: {
        default: "",
        line: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "state-layer relative isolate inline-flex min-w-24 items-center justify-center gap-2 px-4 type-title-s whitespace-nowrap text-on-surface-variant transition-colors [--focus-ring-offset:-2px] group-data-horizontal/tabs:h-full group-data-vertical/tabs:min-h-12 group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-on-surface disabled:pointer-events-none disabled:opacity-38 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
        "data-active:text-primary group-data-[variant=line]/tabs-list:data-active:text-on-surface",
        "after:absolute after:bg-primary after:opacity-0 after:transition-opacity data-active:after:opacity-100 group-data-horizontal/tabs:after:inset-x-4 group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-[3px] group-data-horizontal/tabs:after:rounded-t-[3px] group-data-vertical/tabs:after:inset-y-2 group-data-vertical/tabs:after:right-0 group-data-vertical/tabs:after:w-[3px] group-data-vertical/tabs:after:rounded-l-[3px] group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:h-0.5 group-data-[variant=line]/tabs-list:after:rounded-none",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
