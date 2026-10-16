import type { Account } from "@/components/app/account-menu"
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
 *
 * `account` (name and email) comes from the server session, so the account
 * menu is complete in the first HTML. `railFab` and `floatingFab` hold the
 * Start session button (TodaySessionFab inside Suspense) for the rail and
 * for compact windows.
 */
export function AppShell({
  account,
  railFab,
  floatingFab,
  children,
}: {
  account: Account
  railFab?: React.ReactNode
  floatingFab?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <AppBarTitleProvider>
      <SkipLink />
      <NavigationRail fab={railFab} />
      <div className="flex min-h-dvh flex-col sm:pl-(--rail-width)">
        <TopAppBar account={account} />
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col pb-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] sm:pb-0"
        >
          {children}
        </main>
      </div>
      {floatingFab}
      <BottomNav />
    </AppBarTitleProvider>
  )
}
