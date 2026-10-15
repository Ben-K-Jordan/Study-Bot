import { PageContainer } from "@/components/app/page-container"
import { CardSkeleton, LoadingRegion, PageHeaderSkeleton } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Deck library skeleton: the due summary, then course sections with deck cards. */
export default function Loading() {
  return (
    <PageContainer>
      <LoadingRegion label="Loading decks…" className="flex flex-col gap-6">
        <PageHeaderSkeleton />
        <div className="flex flex-col gap-10">
          {[0, 1].map((section) => (
            <div key={section} aria-hidden="true" className="flex flex-col gap-4">
              <div className="flex min-h-10 items-center justify-between gap-4">
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-5 w-32" />
                  <Skeleton className="h-4 w-44" />
                </div>
                <Skeleton className="h-8 w-36 rounded-full" />
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <CardSkeleton lines={2} />
                <CardSkeleton lines={2} className="hidden md:flex" />
              </div>
            </div>
          ))}
        </div>
      </LoadingRegion>
    </PageContainer>
  )
}
