import type { StudyGuideData } from "@/services/study-guides"

export type StudyGuide = StudyGuideData

/** GET /api/guides */
export interface GuidesResponse {
  guides: StudyGuide[]
}
