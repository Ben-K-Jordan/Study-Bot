import { CardSkeleton, LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function Heading() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-4 w-full max-w-xl" />
    </div>
  )
}

export function MasterySkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Heading />
      <Skeleton className="h-8 w-52 rounded-full" />
      <div className="grid gap-4 lg:grid-cols-2">
        <CardSkeleton lines={5} />
        <CardSkeleton lines={5} />
      </div>
    </div>
  )
}

export function BlockSkeleton({ lines = 4, double = false }: { lines?: number; double?: boolean }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <Heading />
      <div className={double ? "grid gap-4 md:grid-cols-2" : "grid"}>
        <CardSkeleton lines={lines} />
        {double ? <CardSkeleton lines={lines} /> : null}
      </div>
    </div>
  )
}

/** Progress while its first data loads: the same sections, in order. */
export function ProgressSkeleton() {
  return (
    <LoadingRegion label="Loading Progress…" className="flex flex-col gap-10">
      <MasterySkeleton />
      <BlockSkeleton lines={5} />
      <BlockSkeleton lines={3} double />
      <BlockSkeleton lines={4} />
    </LoadingRegion>
  )
}
