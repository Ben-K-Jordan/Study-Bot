import { cn } from "@/lib/utils"
import { formatPercent } from "@/lib/format"

/**
 * Mastery of one topic, from 0 to 1, as a labelled meter. The percentage is
 * always printed, so colour only reinforces it: low in warning, middle in
 * primary, high in tertiary (success).
 */
export function MasteryBar({
  value,
  label,
  status,
  className,
}: {
  value: number
  /** The topic: "Recursion". */
  label: string
  /** Optional status word from the server, such as "Mastered". */
  status?: string
  className?: string
}) {
  const ratio = Math.min(1, Math.max(0, value))
  const percent = formatPercent(ratio)
  const tone = ratio >= 0.8 ? "bg-tertiary" : ratio >= 0.4 ? "bg-primary" : "bg-warning"

  return (
    <div data-slot="mastery-bar" className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 break-words type-body-m text-on-surface">{label}</span>
        <span className="shrink-0 type-label-m text-on-surface-variant tabular-nums">
          {status ? `${status}, ${percent}` : percent}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${label} mastery`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(ratio * 100)}
        aria-valuetext={status ? `${percent}, ${status}` : percent}
        // In forced colours the track is outlined and the fill drawn in a
        // system colour, since both backgrounds would otherwise disappear.
        className="h-2 w-full overflow-hidden rounded-full bg-surface-container-highest forced-colors:border forced-colors:border-[CanvasText]"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-250 ease-standard forced-colors:bg-[CanvasText]", tone)}
          style={{ width: `${ratio * 100}%` }}
        />
      </div>
    </div>
  )
}
