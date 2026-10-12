import { LoadingRegion } from "@/components/app/skeletons";
import { Skeleton } from "@/components/ui/skeleton";

/** Placeholder in the shape of a lesson: top bar, question, four options. */
export default function SessionLoading() {
  return (
    <LoadingRegion label="Loading session…" className="flex flex-1 flex-col">
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
