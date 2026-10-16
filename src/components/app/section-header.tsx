import Link from "next/link"
import { ChevronRightIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

/**
 * Heading for a section of a page, with an optional link to the full view
 * ("All sessions") or any action on the right. Give the section
 * aria-labelledby={id} so the heading names the region.
 */
export function SectionHeader({
  id,
  title,
  description,
  action,
  as: Heading = "h2",
  className,
}: {
  id?: string
  title: React.ReactNode
  description?: React.ReactNode
  /** A link to the full view, or any element (a button, a menu). */
  action?: { href: string; label: string } | React.ReactNode
  as?: "h2" | "h3"
  className?: string
}) {
  const link =
    action && typeof action === "object" && "href" in action && "label" in action
      ? (action as { href: string; label: string })
      : null

  return (
    <div
      data-slot="section-header"
      className={cn("flex min-h-10 items-center justify-between gap-4", className)}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <Heading id={id} className="type-title-m text-on-surface">
          {title}
        </Heading>
        {description ? (
          <p className="type-body-m text-on-surface-variant">{description}</p>
        ) : null}
      </div>
      {link ? (
        <Button asChild variant="text" size="sm" className="-mr-3 shrink-0">
          <Link href={link.href}>
            {link.label}
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      ) : action ? (
        <div className="flex shrink-0 items-center gap-2">{action as React.ReactNode}</div>
      ) : null}
    </div>
  )
}
