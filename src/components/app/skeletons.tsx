import { cn } from "@/lib/utils"
import { Skeleton } from "@/components/ui/skeleton"

/** Loading placeholder for one card. Decorative; wrap groups in LoadingRegion. */
export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("flex flex-col gap-4 rounded-2xl bg-card p-6 ring-1 ring-border", className)}
    >
      <Skeleton className="h-5 w-2/5" />
      <div className="flex flex-col gap-2.5">
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    </div>
  )
}

/** Loading placeholder for a list of rows with a leading icon. */
export function ListSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col divide-y divide-border", className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 py-3">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Loading placeholder for a PageHeader. */
export function PageHeaderSkeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-2", className)}>
      <Skeleton className="h-7 w-56 max-w-full" />
      <Skeleton className="h-4 w-80 max-w-full" />
    </div>
  )
}

/**
 * Wraps skeletons so assistive tech hears one "Loading…" instead of
 * nothing. Keep it mounted only while loading.
 */
export function LoadingRegion({
  label = "Loading…",
  className,
  children,
}: {
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div role="status" aria-live="polite" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** The default page skeleton: a header and a grid of cards. */
export function PageSkeleton({ cards = 4 }: { cards?: number }) {
  return (
    <LoadingRegion className="flex flex-col gap-6">
      <PageHeaderSkeleton />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: cards }, (_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </LoadingRegion>
  )
}
