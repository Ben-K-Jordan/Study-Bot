import { PageContainer } from "@/components/app/page-container"
import { LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

/** Chat skeleton: course picker, a few messages, and the question box. */
export default function Loading() {
  return (
    <PageContainer size="narrow" className="flex-1">
      <LoadingRegion label="Loading chat…" className="flex flex-1 flex-col gap-6">
        <div aria-hidden="true" className="flex flex-1 flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-10 w-56 rounded-md" />
            <Skeleton className="mt-1 h-4 w-80 max-w-full" />
          </div>
          <div className="flex justify-end">
            <Skeleton className="h-11 w-3/5 rounded-3xl" />
          </div>
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
          <div className="mt-auto flex flex-col gap-2">
            <Skeleton className="h-4 w-52" />
            <Skeleton className="h-24 w-full rounded-md" />
          </div>
        </div>
      </LoadingRegion>
    </PageContainer>
  )
}
