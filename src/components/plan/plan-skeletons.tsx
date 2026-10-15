import { PageContainer } from "@/components/app/page-container"
import { LoadingRegion, PageHeaderSkeleton } from "@/components/app/skeletons"
import { Skeleton } from "@/components/ui/skeleton"

function NavSkeleton() {
  return (
    <>
      <div aria-hidden="true" className="hidden w-64 shrink-0 flex-col gap-4 lg:flex">
        <Skeleton className="h-12 w-36 rounded-full" />
        <div className="flex flex-col gap-2 pt-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-full" />
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="flex flex-col gap-3 lg:hidden">
        <div className="flex gap-2">
          <Skeleton className="h-10 w-32 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
        <div className="flex gap-2 overflow-hidden">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-8 w-40 shrink-0 rounded-md" />
          ))}
        </div>
      </div>
    </>
  )
}

/** Shell of the Plan area while the server reads: nav, header, progress and agenda rows. */
export function PlanPageSkeleton({ variant = "plan" }: { variant?: "plan" | "form" | "materials" }) {
  return (
    <PageContainer size="wide">
      <LoadingRegion
        label={variant === "materials" ? "Loading materials…" : "Loading your plan…"}
        className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8"
      >
        <NavSkeleton />
        <div aria-hidden="true" className="flex min-w-0 flex-1 flex-col gap-6">
          <PageHeaderSkeleton />
          {variant === "plan" ? (
            <>
              <div className="flex flex-wrap gap-2">
                <Skeleton className="h-10 w-48 rounded-full" />
                <Skeleton className="h-10 w-52 rounded-full" />
              </div>
              <Skeleton className="h-28 w-full rounded-2xl" />
              <div className="flex flex-col">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="grid grid-cols-[3rem_1fr] gap-x-2 border-t border-outline-variant py-4 first:border-t-0 sm:grid-cols-[4.5rem_1fr] sm:gap-x-4">
                    <div className="flex flex-col items-center gap-1">
                      <Skeleton className="h-3 w-8" />
                      <Skeleton className="size-10 rounded-full" />
                    </div>
                    <div className="flex flex-col gap-2 px-4 py-1">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3.5 w-48 max-w-full" />
                      <Skeleton className="h-3.5 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-6 rounded-2xl bg-card p-6 ring-1 ring-border">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-12 w-full rounded-md" />
                </div>
              ))}
              <Skeleton className="h-36 w-full rounded-2xl" />
            </div>
          )}
        </div>
      </LoadingRegion>
    </PageContainer>
  )
}
