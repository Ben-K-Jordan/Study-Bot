import { Children, isValidElement } from "react"

import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/** One settings section: a card with an h2 and the section's rows. */
export function SettingsSection({
  id,
  title,
  description,
  children,
  className,
}: {
  /** Anchor id; the section list links to `#id`. */
  id: string
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  const titleId = `${id}-title`
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className={cn("scroll-mt-[calc(var(--app-bar-height)+1.5rem)]", className)}
    >
      <Card className="max-sm:[--card-spacing:--spacing(4)]">
        <CardHeader>
          <h2 id={titleId} className="type-title-l text-on-surface">
            {title}
          </h2>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="@container flex flex-col">{children}</CardContent>
      </Card>
    </section>
  )
}

/**
 * Rows inside a section, separated by hairlines. Each child becomes one
 * row (a Field, a FieldSet, a SettingsRow or an alert); empty children are
 * skipped. Rows get their own wrapper so a fieldset's legend and an
 * alert's padding stay as their components draw them.
 */
export function SettingsRows({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col divide-y divide-border", className)}>
      {Children.toArray(children).map((child, index) => (
        <div
          key={isValidElement(child) && child.key != null ? child.key : index}
          className="min-w-0 py-5 first:pt-0 last:pb-0"
        >
          {child}
        </div>
      ))}
    </div>
  )
}

/**
 * A row that isn't a form field: a heading-level label, an optional
 * description, and the content (a value, a status or an action).
 */
export function SettingsRow({
  title,
  titleId,
  description,
  children,
  className,
}: {
  title: string
  titleId?: string
  description?: React.ReactNode
  children?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="type-title-s text-on-surface">
          {title}
        </h3>
        {description ? <p className="type-body-s text-on-surface-variant">{description}</p> : null}
      </div>
      {children}
    </div>
  )
}
