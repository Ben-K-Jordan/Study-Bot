import { redirect } from "next/navigation"

import { publicConfig } from "@/app/api/config/flags"
import { readGoogleStatus } from "@/app/api/integrations/google/status/status-dto"
import { readSettings } from "@/app/api/settings/data"
import { PageContainer } from "@/components/app/page-container"
import { ThemeToggle } from "@/components/app/theme-toggle"
import { AccountSection } from "@/components/settings/account-section"
import { AiSection } from "@/components/settings/ai-section"
import { ConnectResultBanner } from "@/components/settings/connect-result-banner"
import { DataSection } from "@/components/settings/data-section"
import { GoogleCalendarSection } from "@/components/settings/google-calendar-section"
import { PreferencesForm, type AccountSummary } from "@/components/settings/preferences-form"
import { SettingsNav, type SettingsNavItem } from "@/components/settings/settings-nav"
import { SettingsRows, SettingsSection } from "@/components/settings/settings-section"
import { Field, FieldDescription, FieldTitle } from "@/components/ui/field"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { googleConnectResult } from "@/lib/google/messages"
import { logger } from "@/lib/logger"

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/** Resolves to null instead of throwing, so one failed read can't take the page down. */
async function orNull<T>(label: string, userId: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise
  } catch (err) {
    logger.error("settings.page_load_failed", { part: label, user_id: userId, error: String(err) })
    return null
  }
}

export default async function SettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const userId = await getCurrentUserId()
  if (!userId) redirect("/auth/signin?callbackUrl=%2Fsettings")

  const [params, user, settings, google] = await Promise.all([
    searchParams,
    orNull(
      "account",
      userId,
      prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } })
    ),
    orNull("settings", userId, readSettings(userId)),
    orNull("google", userId, readGoogleStatus(userId)),
  ])

  const config = publicConfig()
  const dev = process.env.NODE_ENV !== "production"
  const account: AccountSummary | null = user ? { name: user.name, email: user.email } : null
  const connectResult = googleConnectResult(first(params.google), first(params.reason), { dev })
  // Without Google credentials there's nothing to connect; only developers need to hear why.
  const showCalendar = config.google_configured || dev

  const sections: SettingsNavItem[] = [
    { id: "profile", label: "Profile" },
    { id: "study", label: "Study preferences" },
    { id: "appearance", label: "Appearance" },
    ...(showCalendar ? [{ id: "calendar", label: "Google Calendar" }] : []),
    { id: "ai", label: "AI features" },
    { id: "data", label: "Data" },
    { id: "account", label: "Account" },
  ]

  return (
    <PageContainer>
      <div className="grid gap-8 md:grid-cols-[13rem_minmax(0,1fr)] lg:grid-cols-[15rem_minmax(0,1fr)]">
        <SettingsNav items={sections} />
        <div className="flex max-w-3xl min-w-0 flex-col gap-6">
          {connectResult ? <ConnectResultBanner result={connectResult} /> : null}

          <PreferencesForm initial={settings} account={account} />

          <SettingsSection id="appearance" title="Appearance">
            <SettingsRows>
              <Field>
                <FieldTitle>Theme</FieldTitle>
                <FieldDescription>
                  Applies right away, on this device only. System follows your device&apos;s light or
                  dark setting.
                </FieldDescription>
                <ThemeToggle variant="segmented" />
              </Field>
            </SettingsRows>
          </SettingsSection>

          {showCalendar ? (
            <GoogleCalendarSection initial={google} configured={config.google_configured} dev={dev} />
          ) : null}

          <AiSection config={config} dev={dev} />
          <DataSection />
          <AccountSection email={account?.email ?? null} />
        </div>
      </div>
    </PageContainer>
  )
}
