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
 * The rail, the app bar and the bottom bar sit at the top level of the
 * shell, outside the content column. React only runs a <ViewTransition>'s
 * enter and exit when no DOM element around it is inserted or removed with
 * it, so this is what lets all three recede when a session opens.
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
      <TopAppBar account={account} />
      <div className="flex min-h-dvh flex-col pt-(--app-bar-height) sm:pl-(--rail-width) print:p-0">
        <main
          id="main-content"
          tabIndex={-1}
          className="flex flex-1 flex-col pb-[calc(var(--bottom-bar-height)+env(safe-area-inset-bottom))] sm:pb-0 print:pb-0"
        >
          {children}
        </main>
      </div>
      {floatingFab}
      <BottomNav />
    </AppBarTitleProvider>
  )
}
