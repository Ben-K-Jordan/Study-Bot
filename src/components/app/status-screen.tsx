import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Full-area message for not-found and failed pages: an icon in a tonal
 * circle, a heading, one or two sentences, and actions. Use inside a
 * layout's <main>; it does not render a landmark itself.
 */
export function StatusScreen({
  icon: Icon,
  tone = "neutral",
  title,
  description,
  actions,
  footnote,
  headingLevel = "h1",
  className,
}: {
  icon: LucideIcon
  tone?: "neutral" | "error"
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
  /** Small print under the actions, such as "Reference: 3f9a…". */
  footnote?: React.ReactNode
  headingLevel?: "h1" | "h2"
  className?: string
}) {
  const Heading = headingLevel
  return (
    <div
      data-slot="status-screen"
      className={cn(
        "mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center",
        className
      )}
    >
      <span
        className={cn(
          "flex size-16 items-center justify-center rounded-full",
          tone === "error"
            ? "bg-error-container text-on-error-container"
            : "bg-secondary-container text-on-secondary-container"
        )}
      >
        <Icon className="size-8" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <Heading className="type-headline-s text-balance text-on-surface">{title}</Heading>
        {description ? (
          <p className="type-body-l text-pretty text-on-surface-variant">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">{actions}</div>
      ) : null}
      {footnote ? <p className="type-body-s text-on-surface-variant">{footnote}</p> : null}
    </div>
  )
}
