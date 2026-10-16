import { cn } from "@/lib/utils"

/**
 * The standard content column inside the app shell, with M3 gutters (16px
 * compact, 24px medium, 32px expanded) and 24px between sections. `narrow`
 * suits forms, chat and guides, `wide` suits the plan grid.
 *
 * Every size starts at the same left edge (where the wide column starts) and
 * only its right edge moves, so shared controls such as the course switcher
 * stay put when the student moves between destinations.
 */
export function PageContainer({
  className,
  size = "default",
  ...props
}: React.ComponentProps<"div"> & { size?: "narrow" | "default" | "wide" }) {
  return (
    <div
      data-slot="page-container"
      className={cn(
        "flex w-full flex-col gap-6 px-4 pt-2 pb-10 sm:px-6 md:px-8",
        // The wide column's left margin: half of whatever the window has
        // beyond 80rem (max-w-7xl).
        "ml-[max(0px,calc((100%_-_80rem)/2))]",
        size === "narrow" && "max-w-3xl",
        size === "default" && "max-w-6xl",
        size === "wide" && "max-w-7xl",
        className
      )}
      {...props}
    />
  )
}
