/** One course file as the Materials screens show it. */
export interface MaterialDoc {
  document_id: string
  course_name: string | null
  exam_name: string | null
  title: string
  original_filename: string
  mime_type: string
  /** UPLOADED, PROCESSED or FAILED */
  status: string
  /** Sections the file was split into. */
  chunk_count: number
  summary: string | null
  suggested_questions: string[] | null
  created_at: string
}
