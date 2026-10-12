import { AppMark } from "@/components/shell/app-mark";

/**
 * Sign-in, sign-up and password screens: a centred card on a tonal page
 * with the Study Bot mark above it, and no app navigation.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-surface-container">
      <main
        id="main-content"
        tabIndex={-1}
        className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10 sm:py-16"
      >
        <div className="flex items-center gap-3">
          <AppMark className="size-10" />
          <span className="type-title-l text-on-surface">Study Bot</span>
        </div>
        <div className="flex w-full max-w-md flex-col items-center">{children}</div>
      </main>
    </div>
  );
}
