import { LoadingRegion } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder in the shape of the session intro: close button, title, facts, Start bar. */
export function PreflightSkeleton() {
  return (
    <LoadingRegion label="Loading session…" className="flex min-h-dvh flex-1 flex-col">
      <div aria-hidden="true" className="mx-auto flex w-full max-w-4xl items-center px-4 py-4 sm:px-8 sm:py-6">
        <Skeleton className="size-11 rounded-full" />
      </div>
      <div
        aria-hidden="true"
        className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 pt-2 pb-10 sm:px-8 sm:pt-4"
      >
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-5 w-4/5" />
        </div>
        <div className="flex flex-col divide-y-2 divide-lesson-option-border rounded-2xl border-2 border-lesson-option-border">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-4 sm:px-5">
              <Skeleton className="size-5 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
      <div aria-hidden="true" className="border-t-2 border-lesson-option-border">
        <div className="mx-auto flex w-full max-w-4xl justify-end px-4 py-4 sm:px-8 sm:py-6">
          <Skeleton className="h-12 w-full rounded-2xl sm:w-44" />
        </div>
      </div>
    </LoadingRegion>
  );
}

/** Placeholder in the shape of a question: top bar, question, four options. */
export function QuestionSkeleton() {
  return (
    <LoadingRegion label="Loading question…" className="flex min-h-dvh flex-1 flex-col">
      <div aria-hidden="true" className="mx-auto flex w-full max-w-4xl items-center gap-4 px-4 py-4 sm:px-8 sm:py-6">
        <Skeleton className="size-11 rounded-full" />
        <Skeleton className="h-4 flex-1 rounded-full" />
        <Skeleton className="h-5 w-24" />
      </div>
      <div aria-hidden="true" className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 pt-4 sm:px-8 sm:pt-8">
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/5" />
        </div>
        <div className="flex flex-col gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-2xl" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  );
}
