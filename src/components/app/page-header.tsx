import { cn } from "@/lib/utils"

/**
 * A view's own headline row under the top app bar: the specific object
 * ("Prelim 1 plan", "CS 2110"), a line of supporting text, and actions on
 * the right. The app bar already shows the destination name as the page's
 * h1, so the title here is an h2 by default and must not repeat it.
 */
export function PageHeader({
  title,
  description,
  actions,
  as: Heading = "h2",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  as?: "h1" | "h2"
}) {
  return (
    <div
      data-slot="page-header"
      className={cn("flex flex-wrap items-end justify-between gap-x-6 gap-y-4", className)}
      {...props}
    >
      {title || description ? (
        <div className="flex min-w-0 max-w-prose flex-col gap-1">
          {title ? (
            <Heading className="type-headline-s text-balance text-on-surface">{title}</Heading>
          ) : null}
          {description ? (
            <p className="type-body-l text-pretty text-on-surface-variant">{description}</p>
          ) : null}
        </div>
      ) : null}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
