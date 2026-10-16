import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/skeletons";

/**
 * Home's skeleton. It lives in Home's own route group so it doesn't wrap the
 * other (app) pages: a page with no loading boundary above it (the deck
 * page) can still answer a missing record with a real 404.
 */
export default function HomeLoading() {
  return (
    <PageContainer>
      <PageSkeleton />
    </PageContainer>
  );
}
