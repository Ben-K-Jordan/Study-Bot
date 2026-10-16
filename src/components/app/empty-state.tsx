import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"

/**
 * What this place is, how to fill it, and one action. Never use it for a
 * failed load (that is ErrorState) or while loading (that is a skeleton).
 *
 *   <EmptyState
 *     icon={LayersIcon}
 *     title="No decks for CS 2110 yet"
 *     description="Generate one from your CS 2110 materials."
 *     action={<Button>Generate deck</Button>}
 *   />
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = "h3",
  bordered = false,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: React.ReactNode
  /** One primary action, usually a Button or a Button asChild Link. */
  action?: React.ReactNode
  headingLevel?: "h2" | "h3"
  /** Draws a dashed outline, for an empty slot inside a page section. */
  bordered?: boolean
  className?: string
}) {
  const Heading = headingLevel
  return (
    <Empty
      className={cn(bordered && "border border-dashed border-outline-variant", className)}
    >
      <EmptyHeader>
        {Icon ? (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        ) : null}
        <EmptyTitle>
          <Heading className="contents">{title}</Heading>
        </EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}
