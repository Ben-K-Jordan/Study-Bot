import { PageContainer } from "@/components/app/page-container"
import { GuidesSkeleton } from "@/components/guides/guides-skeleton"

export default function Loading() {
  return (
    <PageContainer size="narrow">
      <GuidesSkeleton />
    </PageContainer>
  )
}
