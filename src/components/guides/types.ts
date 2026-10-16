import type { StudyGuideData, StudyGuideListItem } from "@/services/study-guides"

/** A guide with its sections. */
export type StudyGuide = StudyGuideData

/** A guide in the list; `sections` only on the newest of each format. */
export type StudyGuideSummary = StudyGuideListItem

/** GET /api/guides */
export interface GuidesResponse {
  guides: StudyGuideSummary[]
}

/** GET /api/guides/{guideId} */
export interface GuideResponse {
  guide: StudyGuide
}
