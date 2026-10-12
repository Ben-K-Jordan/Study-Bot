"use client"

import * as React from "react"
import { FlameIcon, LayersIcon, PlusIcon, SearchXIcon, TargetIcon, ZapIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { AccountMenu } from "@/components/app/account-menu"
import { CountdownCard } from "@/components/app/countdown-card"
import { CourseSwitcher } from "@/components/app/course-switcher"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorBoundary } from "@/components/app/error-boundary"
import { ErrorState } from "@/components/app/error-state"
import { KbdHint } from "@/components/app/kbd-hint"
import { MasteryBar } from "@/components/app/mastery-bar"
import { PageHeader } from "@/components/app/page-header"
import { ProgressLinear } from "@/components/app/progress-linear"
import { SectionHeader } from "@/components/app/section-header"
import { CardSkeleton, ListSkeleton, PageHeaderSkeleton } from "@/components/app/skeletons"
import { StatLine } from "@/components/app/stat-line"
import { StatusScreen } from "@/components/app/status-screen"
import { ThemeToggle } from "@/components/app/theme-toggle"

import { Block, ShowcaseSection } from "./helpers"

// Fixed dates so every reviewer sees the same countdowns.
const NOW = new Date("2026-10-12T16:00:00Z")
const ZONE = "America/New_York"

function Thrower(): React.ReactNode {
  throw new Error("Demo render failure")
}

export function AppComponents() {
  const [broken, setBroken] = React.useState(false)
  const [retrying, setRetrying] = React.useState(false)

  return (
    <ShowcaseSection
      id="app"
      title="App components"
      description="Shared pieces in src/components/app. Screens compose these instead of styling their own."
    >
      <Block title="PageHeader" description="The app bar already shows the destination name as the h1; PageHeader names the specific object.">
        <PageHeader
          title="Prelim 1 plan"
          description="14 sessions between today and Thu, Oct 22. Sessions fall between 9:00 AM and 9:00 PM."
          actions={
            <>
              <Button variant="outline">Export calendar (.ics)</Button>
              <Button>
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
                New plan
              </Button>
            </>
          }
        />
      </Block>

      <Block title="SectionHeader">
        <div className="flex flex-col gap-4">
          <SectionHeader title="Weak spots" description="Unresolved errors and low-mastery topics." action={{ href: "/achievements", label: "All topics" }} />
          <SectionHeader as="h3" title="Follow-up sessions" action={<Button variant="outline" size="sm">Add follow-ups to plan</Button>} />
        </div>
      </Block>

      <Block title="CountdownCard" description="The nearest exam is featured in the primary container. Pass the student's time zone.">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <CountdownCard
            featured
            examName="Prelim 1"
            courseName="CS 2110"
            examDate="2026-10-21T14:00:00Z"
            timeZone={ZONE}
            now={NOW}
            sessionsDone={9}
            sessionsTotal={14}
            missedCount={1}
            rescheduleHref="/plan"
            href="/plan"
          />
          <CountdownCard
            examName="Midterm"
            courseName="MATH 1920"
            examDate="2026-10-13T14:00:00Z"
            timeZone={ZONE}
            now={NOW}
            sessionsDone={11}
            sessionsTotal={12}
          />
          <CountdownCard
            examName="Final"
            courseName="INFO 1300"
            examDate="2026-10-12T20:00:00Z"
            timeZone={ZONE}
            now={NOW}
          />
          <CountdownCard
            examName="Quiz 3"
            courseName="ECON 1110"
            examDate="2026-10-09T20:00:00Z"
            timeZone={ZONE}
            now={NOW}
            sessionsDone={4}
            sessionsTotal={4}
          />
        </div>
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="ProgressLinear" description="M3 linear indicator with a gap and stop dot.">
          <div className="flex flex-col gap-5">
            {[0, 35, 64, 100].map((v) => (
              <div key={v} className="flex items-center gap-4">
                <span className="w-10 font-mono text-xs text-on-surface-variant tabular-nums">{v}%</span>
                <ProgressLinear value={v} label={`Example at ${v}%`} />
              </div>
            ))}
            <div className="flex items-center gap-4">
              <span className="w-10 font-mono text-xs text-on-surface-variant">busy</span>
              <ProgressLinear value={null} label="Uploading lecture-4.pdf" />
            </div>
            <div className="flex items-center gap-4">
              <span className="w-10 font-mono text-xs text-on-surface-variant">tones</span>
              <div className="flex flex-1 flex-col gap-3">
                <ProgressLinear value={80} tone="tertiary" label="Success tone" />
                <ProgressLinear value={30} tone="warning" label="Warning tone" />
                <ProgressLinear value={15} tone="error" label="Error tone" />
              </div>
            </div>
          </div>
        </Block>
        <Block title="MasteryBar" description="Low in warning, middle in primary, high in success. The number is always printed.">
          <div className="flex flex-col gap-4">
            <MasteryBar label="Recursion" value={0.22} />
            <MasteryBar label="Stacks and queues" value={0.58} />
            <MasteryBar label="Big-O notation" value={0.86} status="Mastered" />
            <MasteryBar label="Amortized analysis of dynamic arrays and hash tables" value={0} />
          </div>
        </Block>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="StatLine" description="The quiet stats row. Never inside a session.">
          <div className="flex flex-col gap-4">
            <StatLine
              items={[
                { value: "12-day streak", icon: FlameIcon },
                { value: "83%", label: "accuracy", icon: TargetIcon },
                { value: "340 XP", icon: ZapIcon },
              ]}
            />
            <StatLine items={[{ value: "No accuracy yet" }, { value: "0 XP" }]} />
          </div>
        </Block>
        <Block title="Shell controls" description="CourseSwitcher reads your real course list; the theme and account controls are live.">
          <div className="flex flex-col gap-5">
            <CourseSwitcher />
            <div className="flex flex-wrap items-center gap-3">
              <ThemeToggle />
              <ThemeToggle variant="segmented" />
              <AccountMenu />
            </div>
            <div className="flex items-center gap-2 type-body-m text-on-surface-variant">
              <KbdHint keys={["Mod", "Enter"]} /> KbdHint resolves Mod to Ctrl or Cmd
            </div>
          </div>
        </Block>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="EmptyState" description="What this place is, how to fill it, one action.">
          <EmptyState
            bordered
            icon={LayersIcon}
            title="No decks for CS 2110 yet"
            description="Generate one from your CS 2110 materials."
            action={<Button>Generate deck</Button>}
          />
        </Block>
        <Block title="ErrorState" description="A failed load is never an empty state.">
          <div className="flex flex-col gap-4">
            <ErrorState
              title="Decks didn't load."
              onRetry={() => {
                setRetrying(true)
                setTimeout(() => setRetrying(false), 1200)
              }}
              retrying={retrying}
            />
            <ErrorState
              title="Plans didn't load."
              description="Your sign-in expired. Sign in again."
              reference="a1b2c3d4"
            />
            <ErrorBoundary title="This card didn't load.">
              {broken ? <Thrower /> : (
                <Button variant="outline" onClick={() => setBroken(true)}>
                  Break this card (ErrorBoundary)
                </Button>
              )}
            </ErrorBoundary>
          </div>
        </Block>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Skeleton layouts">
          <div className="flex flex-col gap-4">
            <PageHeaderSkeleton />
            <CardSkeleton />
            <ListSkeleton rows={2} />
          </div>
        </Block>
        <Block title="StatusScreen" description="Not-found and failed pages.">
          <StatusScreen
            headingLevel="h2"
            icon={SearchXIcon}
            title="Session not found"
            description="This link doesn't match a session. It may have been deleted."
            actions={<Button>Go to Home</Button>}
            className="py-6"
          />
        </Block>
      </div>
    </ShowcaseSection>
  )
}
