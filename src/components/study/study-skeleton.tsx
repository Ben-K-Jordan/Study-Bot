import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LoadingRegion } from "@/components/app/skeletons"

/** The next-session card while its recommendation loads. */
export function NextSessionSkeleton() {
  return (
    <Card aria-hidden="true">
      <CardHeader className="gap-3">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-5 w-full max-w-md" />
        <Skeleton className="h-4 w-4/5 max-w-lg" />
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Skeleton className="h-4 w-16" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-start gap-4 px-4 py-3">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3.5 w-3/4" />
            </div>
          </div>
        ))}
        <Skeleton className="mt-2 h-4 w-16" />
        <Skeleton className="h-10 w-64 rounded-full" />
      </CardContent>
      <CardFooter className="border-t border-border">
        <Skeleton className="h-12 w-44 rounded-full" />
      </CardFooter>
    </Card>
  )
}

/** A titled list card (planned sessions, course tools) while it loads. */
export function SideListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <Skeleton className="h-5 w-32" />
      <Card className="gap-0 py-2">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3.5 w-40" />
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

/** The Study page while courses load: switcher, session card, side lists. */
export function StudySkeleton() {
  return (
    <LoadingRegion label="Loading Study…" className="flex flex-col gap-6">
      <div aria-hidden="true" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-12 w-full rounded-md sm:w-64" />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <NextSessionSkeleton />
        <div className="flex flex-col gap-6">
          <SideListSkeleton rows={1} />
          <SideListSkeleton rows={4} />
        </div>
      </div>
    </LoadingRegion>
  )
}
