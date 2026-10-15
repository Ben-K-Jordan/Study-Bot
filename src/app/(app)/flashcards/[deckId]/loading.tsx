import { PageContainer } from "@/components/app/page-container"
import { CardSkeleton, LoadingRegion, PageHeaderSkeleton } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Deck page skeleton: back link, title and actions, counts, then the card list. */
export default function Loading() {
  return (
    <PageContainer size="narrow">
      <LoadingRegion label="Loading deck…" className="flex flex-col gap-6">
        <div aria-hidden="true" className="flex flex-col gap-6">
          <Skeleton className="h-8 w-28 rounded-full" />
          <PageHeaderSkeleton />
          <div className="grid grid-cols-4 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <Skeleton className="h-7 w-8" />
                <Skeleton className="h-3 w-16" />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3">
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
            <CardSkeleton lines={2} />
          </div>
        </div>
      </LoadingRegion>
    </PageContainer>
  )
}
