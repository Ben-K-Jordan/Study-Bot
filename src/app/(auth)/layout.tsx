import { ThemeToggle } from "@/components/app/theme-toggle";

/**
 * Sign-in, create account, password and verification screens, laid out like
 * Google's sign-in: one card centred on a tonal page with the theme control
 * under it, and no app navigation. Under 600px the page itself is the card.
 * Each page renders its own AuthCard, whose title is the page's h1.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-card sm:items-center sm:justify-center sm:bg-surface-container sm:px-6 sm:py-10">
      <div className="flex w-full flex-1 flex-col sm:max-w-[30rem] sm:flex-none md:max-w-[65rem]">
        <main id="main-content" tabIndex={-1} className="flex flex-1 flex-col">
          {children}
        </main>
        <footer className="flex items-center px-3 py-2 sm:px-0 sm:pt-3">
          <ThemeToggle />
        </footer>
      </div>
    </div>
  );
}
