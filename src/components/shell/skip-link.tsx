/** First focusable element on every page; jumps past the navigation. */
export function SkipLink() {
  return (
    <a
      href="#main-content"
      className="fixed top-2 left-2 z-50 -translate-y-24 rounded-full bg-primary px-6 py-3 type-label-l text-primary-foreground shadow-md transition-transform duration-150 ease-standard focus-visible:translate-y-0"
    >
      Skip to main content
    </a>
  )
}
