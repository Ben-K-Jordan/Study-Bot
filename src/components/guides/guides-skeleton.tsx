import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingRegion } from "@/components/app/skeletons"

/** One guide while the list loads: title, meta line, actions, sections. */
export function GuideSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader className="gap-3">
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Skeleton className="h-10 w-44 rounded-full" />
        <Skeleton className="h-10 w-32 rounded-full" />
      </CardContent>
      <CardContent className="flex flex-col gap-6">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2.5">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

/** The Study guides page while courses load: course select, tabs, a guide. */
export function GuidesSkeleton() {
  return (
    <LoadingRegion label="Loading study guides…" className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-12 w-full rounded-md sm:w-64" />
      </div>
      <div aria-hidden="true" className="flex h-12 items-end gap-6 border-b border-border px-4">
        <Skeleton className="mb-3 h-4 w-24" />
        <Skeleton className="mb-3 h-4 w-12" />
        <Skeleton className="mb-3 h-4 w-24" />
      </div>
      <GuideSkeleton />
    </LoadingRegion>
  )
}
