import { cn } from "@/lib/utils"

/**
 * The Study Bot mark: a rounded square in primary holding an open book,
 * with a check cut into the right-hand page. Decorative; pair it with
 * visible text. Keep in step with src/app/icon.svg.
 */
export function AppMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="48" height="48" rx="14" className="fill-primary" />
      <path
        d="M22.8 15.9c-3.2-2-7.4-2.7-11.6-2.1v19.4c4.2-.6 8.4.1 11.6 2.1Z"
        className="fill-primary-foreground"
      />
      <path
        d="M25.2 15.9c3.2-2 7.4-2.7 11.6-2.1v19.4c-4.2-.6-8.4.1-11.6 2.1Z"
        className="fill-primary-foreground"
      />
      <path
        d="m28 24.6 2.4 2.4 4.1-4.6"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary"
      />
    </svg>
  )
}
