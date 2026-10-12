import { PageContainer } from "@/components/app/page-container";
import { PageSkeleton } from "@/components/app/skeletons";

export default function AppLoading() {
  return (
    <PageContainer>
      <PageSkeleton />
    </PageContainer>
  );
}
