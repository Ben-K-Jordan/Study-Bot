import type {
  PlannedSessionRef,
  StudyCourseSummary,
  StudyRecommendations,
  StudyTopic,
} from "@/services/study-recommendations"

export type { PlannedSessionRef, StudyCourseSummary, StudyRecommendations, StudyTopic }

/** GET /api/learn */
export interface LearnResponse {
  courses: StudyCourseSummary[]
  hasCourses: boolean
}

/** POST /api/learn/start */
export interface StartSessionResponse {
  session_id: string
  url: string
  reused: boolean
}
