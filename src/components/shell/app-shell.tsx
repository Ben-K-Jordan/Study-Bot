import { AppBarTitleProvider } from "@/components/shell/app-bar-title"
import { BottomNav } from "@/components/shell/bottom-nav"
import { NavigationRail } from "@/components/shell/navigation-rail"
import { SkipLink } from "@/components/shell/skip-link"
import { TopAppBar } from "@/components/shell/top-app-bar"

/**
 * The signed-in app frame: skip link, navigation rail (600px and up) or
 * bottom navigation bar (under 600px), top app bar, and the one <main>.
 * Pages render inside <main id="main-content">; wrap content in
 * <PageContainer> for the standard width and gutters.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppBarTitleProvider>
      <SkipLink />
      <NavigationRail />
      <div className="flex min-h-dvh flex-col sm:pl-(--rail-width)">
        <TopAppBar />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col pb-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] sm:pb-0"
        >
          {children}
        </main>
      </div>
      <BottomNav />
    </AppBarTitleProvider>
  )
}
