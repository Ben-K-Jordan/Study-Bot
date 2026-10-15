import { LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Review skeleton in the lesson's shape: top bar with progress, the card, the footer button. */
export default function Loading() {
  return (
    <LoadingRegion label="Loading cards…" className="flex min-h-dvh flex-1 flex-col">
      <div aria-hidden="true" className="flex flex-1 flex-col">
        <div className="mx-auto flex w-full max-w-4xl items-center gap-3 px-4 py-4 sm:gap-4 sm:px-8 sm:py-6">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-4 flex-1 rounded-full" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 pt-4 sm:px-8 sm:pt-8">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="border-t-2 border-lesson-option-border">
          <div className="mx-auto flex w-full max-w-4xl justify-end px-4 py-4 sm:px-8 sm:py-6">
            <Skeleton className="h-12 w-full rounded-2xl sm:w-48" />
          </div>
        </div>
      </div>
    </LoadingRegion>
  )
}
