import { SparklesIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

/**
 * The "AI-written" tag that sits beside the heading of every block of
 * AI-written text: feedback explanations, model answers for generated
 * questions, chat answers, decks, guides and material summaries. One look
 * everywhere (VOICE.md, AI disclosure). Inside a session or card review use
 * `tone="lesson"`, which takes the colour of the text around it.
 */
export function AiTag({
  tone = "default",
  className,
}: {
  tone?: "default" | "lesson"
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      data-slot="ai-tag"
      className={cn(tone === "lesson" && "border-current/30 text-current", className)}
    >
      <SparklesIcon data-icon="inline-start" aria-hidden="true" />
      AI-written
    </Badge>
  )
}
