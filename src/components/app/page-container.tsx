import { cn } from "@/lib/utils"

/**
 * The standard content column inside the app shell: centred, with M3
 * gutters (16px compact, 24px medium, 32px expanded) and 24px between
 * sections. `narrow` suits forms and settings, `wide` suits the plan grid.
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
        "mx-auto flex w-full flex-col gap-6 px-4 pt-2 pb-10 sm:px-6 md:px-8",
        size === "narrow" && "max-w-3xl",
        size === "default" && "max-w-6xl",
        size === "wide" && "max-w-7xl",
        className
      )}
      {...props}
    />
  )
}
