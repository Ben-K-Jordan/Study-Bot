import { cn } from "@/lib/utils"

/**
 * The lesson progress bar for a card review: the thick green bar with the
 * top highlight (same look as LessonProgress), counting cards, not questions.
 */
export function ReviewProgress({
  done,
  total,
  className,
}: {
  done: number
  total: number
  className?: string
}) {
  const value = Math.min(done, total)
  const ratio = total > 0 ? value / total : 0
  return (
    <div
      role="progressbar"
      aria-label="Review progress"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={value}
      aria-valuetext={`${value} of ${total} cards done`}
      className={cn("relative h-4 w-full overflow-hidden rounded-full bg-lesson-progress-track", className)}
    >
      <div
        className="relative h-full rounded-full bg-lesson-progress-fill transition-[width] duration-(--duration-long) ease-emphasized"
        style={{ width: `${ratio * 100}%` }}
      >
        {ratio > 0 ? (
          <span aria-hidden="true" className="absolute inset-x-2 top-[3px] h-[5px] rounded-full bg-white/30" />
        ) : null}
      </div>
    </div>
  )
}
