import { CardSkeleton, ListSkeleton, LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function HeaderSkeleton() {
  return <Skeleton aria-hidden="true" className="h-6 w-28" />
}

/** Exams row: the featured card and three more, laid out like the real row. */
export function ExamsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <HeaderSkeleton />
      <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-2 sm:gap-4 sm:px-0 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex w-[85%] shrink-0 flex-col gap-4 rounded-2xl bg-card p-5 ring-1 ring-border sm:w-auto">
            <Skeleton className="h-5 w-2/5" />
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-11 w-1/3" />
            <Skeleton className="h-1 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function WeakSpotsSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <HeaderSkeleton />
      <div className="rounded-2xl bg-card px-6 py-2 ring-1 ring-border">
        <ListSkeleton rows={4} />
      </div>
    </div>
  )
}

export function TodaySkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <HeaderSkeleton />
      <CardSkeleton lines={2} />
    </div>
  )
}

export function StatsSkeleton() {
  return <Skeleton aria-hidden="true" className="h-5 w-full max-w-md" />
}

/** The whole Home page while its first data loads. */
export function HomeSkeleton() {
  return (
    <LoadingRegion label="Loading Home…" className="flex flex-col gap-8">
      <ExamsSkeleton />
      {/* Same grid as the page: Today first on phones, on the right from 840px. */}
      <div className="grid gap-8 md:grid-cols-[3fr_2fr] md:gap-6">
        <div className="min-w-0 md:col-start-2 md:row-start-1">
          <TodaySkeleton />
        </div>
        <div className="min-w-0 md:col-start-1 md:row-start-1">
          <WeakSpotsSkeleton />
        </div>
      </div>
      <StatsSkeleton />
    </LoadingRegion>
  )
}
