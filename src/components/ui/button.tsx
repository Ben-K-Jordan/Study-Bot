import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Material 3 buttons: pill shape, label-l type, a state layer in the content
// colour, and a 48px touch target around the 40px default. A disabled button
// holding a Spinner is busy, not unavailable, so it keeps its colours.
const buttonVariants = cva(
  "group/button state-layer relative isolate inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium tracking-[0.1px] whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150 ease-standard outline-none select-none disabled:pointer-events-none disabled:not-has-data-[slot=spinner]:text-on-surface/38 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        // Filled: the one primary action in a group.
        default:
          "bg-primary text-primary-foreground hover:shadow-sm disabled:shadow-none disabled:not-has-data-[slot=spinner]:bg-on-surface/12",
        // Outlined: secondary actions beside a filled button.
        outline:
          "border-outline bg-transparent text-primary aria-expanded:bg-primary/10 disabled:not-has-data-[slot=spinner]:border-on-surface/12",
        // Tonal: a softer alternative to filled.
        secondary:
          "bg-secondary text-secondary-foreground hover:shadow-sm disabled:shadow-none disabled:not-has-data-[slot=spinner]:bg-on-surface/12",
        // Neutral: icon buttons and quiet actions in toolbars.
        ghost:
          "text-on-surface-variant hover:text-on-surface aria-expanded:bg-on-surface/10 aria-expanded:text-on-surface",
        // Text: low-emphasis actions, dialog actions.
        text: "text-primary",
        // Filled error: confirms a destructive action.
        destructive:
          "bg-destructive text-destructive-foreground hover:shadow-sm disabled:shadow-none disabled:not-has-data-[slot=spinner]:bg-on-surface/12",
        link: "h-auto! px-0! text-primary underline-offset-4 before:hidden after:hidden hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-6 after:absolute after:inset-x-0 after:-inset-y-1 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        sm: "h-8 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-12 gap-2 px-7 text-base has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5 [&_svg:not([class*='size-'])]:size-5",
        icon: "size-10 after:absolute after:-inset-1 [&_svg:not([class*='size-'])]:size-5",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-8 [&_svg:not([class*='size-'])]:size-[18px]",
        "icon-lg": "size-12 [&_svg:not([class*='size-'])]:size-6",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
