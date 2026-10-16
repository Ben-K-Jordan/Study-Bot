import { Suspense } from "react";
import type { Metadata } from "next";
import { getServerSession } from "next-auth";

import type { Account } from "@/components/app/account-menu";
import { AppShell } from "@/components/shell/app-shell";
import { TodaySessionFab } from "@/components/shell/today-session-fab";
import { authOptions } from "@/lib/auth-options";
import { TITLE_TEMPLATE } from "@/lib/metadata";

// Home has no segment of its own, so the group carries its title; every
// other destination sets its own in its layout and keeps the template.
export const metadata: Metadata = {
  title: { default: "Home", template: TITLE_TEMPLATE },
};

/** Name and email for the account menu; empty when there is no session. */
async function loadAccount(): Promise<Account> {
  try {
    const session = await getServerSession(authOptions);
    return { name: session?.user?.name ?? null, email: session?.user?.email ?? null };
  } catch {
    // The menu still offers Settings and Sign out without a name.
    return { name: null, email: null };
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const account = await loadAccount();
  return (
    <AppShell
      account={account}
      railFab={
        <Suspense fallback={null}>
          <TodaySessionFab placement="rail" />
        </Suspense>
      }
      floatingFab={
        <Suspense fallback={null}>
          <TodaySessionFab placement="floating" />
        </Suspense>
      }
    >
      {children}
    </AppShell>
  );
}
