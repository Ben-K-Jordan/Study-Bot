import { SkipLink } from "@/components/shell/skip-link"

/**
 * A flashcard review takes the whole screen like a study session: no rail,
 * no app bar, the .lesson scope (rounded type, lesson palette), and the
 * close button in the review's own top bar.
 */
export default function CardReviewLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lesson flex min-h-dvh flex-col">
      <SkipLink />
      <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  )
}
