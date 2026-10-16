import { PageContainer } from "@/components/app/page-container"
import { LoadingRegion } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function SectionSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6 rounded-2xl bg-card p-4 ring-1 ring-border sm:p-6">
      <Skeleton className="h-6 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-72 max-w-full" />
          <Skeleton className="h-12 w-full max-w-sm rounded-md" />
        </div>
      ))}
    </div>
  )
}

/** Matches the Settings layout: the section list on wide windows, then section cards. */
export default function SettingsLoading() {
  return (
    <PageContainer>
      <LoadingRegion
        label="Loading settings…"
        className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]"
      >
        <div aria-hidden="true" className="hidden flex-col gap-1 md:flex">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-full" />
          ))}
        </div>
        <div className="flex max-w-3xl min-w-0 flex-col gap-6">
          <SectionSkeleton rows={2} />
          <SectionSkeleton rows={3} />
          <SectionSkeleton rows={1} />
        </div>
      </LoadingRegion>
    </PageContainer>
  )
}
