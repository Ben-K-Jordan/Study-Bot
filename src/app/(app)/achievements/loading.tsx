import { PageContainer } from "@/components/app/page-container"
import { ProgressSkeleton } from "@/components/progress/progress-skeleton"

export default function ProgressLoading() {
  return (
    <PageContainer>
      <ProgressSkeleton />
    </PageContainer>
  )
}
