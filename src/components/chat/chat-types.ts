/** Shapes the chat routes return (src/app/api/chat/_lib/messages.ts). */

export interface ChatSource {
  n: number
  chunk_id: string
  /** File title, or null when unknown. */
  title: string | null
  page: number | null
  quote: string
  /** The file was deleted from the materials after the answer. */
  missing: boolean
}

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  /** question: the student's; answer: AI-written; notice: the app's own line. */
  kind: "question" | "answer" | "notice"
  content: string
  /** Inline [n] in an answer refers to sources[n - 1]. */
  sources: ChatSource[]
  createdAt: string
}

export interface HistoryPage {
  messages: ChatMessage[]
  has_more: boolean
  total: number
}

export interface AnswerResponse {
  kind: "answer" | "notice"
  question?: ChatMessage
  answer?: ChatMessage
}

/** A question on its way, or one whose answer failed before the server stored it. */
export interface PendingQuestion {
  localId: string
  courseKey: string
  question: string
  status: "sending" | "failed"
  /** Set when the server already stored the question (retries reuse it). */
  questionId?: string
  error?: string
}

/** Longest question the answer route accepts. */
export const QUESTION_MAX = 2000
