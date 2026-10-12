"use client"

import { CircleAlertIcon, FlameIcon, PlayIcon, TargetIcon, WrenchIcon, ZapIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { CountdownCard } from "@/components/app/countdown-card"
import { EmptyState } from "@/components/app/empty-state"
import { ErrorState } from "@/components/app/error-state"
import { MasteryBar } from "@/components/app/mastery-bar"
import { SectionHeader } from "@/components/app/section-header"
import { StatLine } from "@/components/app/stat-line"

import { ShowcaseSection } from "./helpers"

const NOW = new Date("2026-10-12T16:00:00Z")
const ZONE = "America/New_York"

function Pair({ rule, good, bad }: { rule: string; good: React.ReactNode; bad: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="type-title-s text-on-surface">{rule}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="type-label-m text-tertiary">Do</span>
          {good}
        </div>
        <div className="flex flex-col gap-2 rounded-2xl bg-card p-4 ring-1 ring-border">
          <span className="type-label-m text-destructive">Don&apos;t</span>
          {bad}
        </div>
      </div>
    </div>
  )
}

export function Rules() {
  return (
    <ShowcaseSection id="rules" title="Do and don't" description="The rules screens break most easily.">
      <div className="grid gap-8 lg:grid-cols-2">
        <Pair
          rule="One filled button per group."
          good={
            <div className="flex flex-wrap gap-2">
              <Button variant="text">Cancel</Button>
              <Button>Create plan</Button>
            </div>
          }
          bad={
            <div className="flex flex-wrap gap-2">
              <Button>Cancel</Button>
              <Button>Create plan</Button>
            </div>
          }
        />
        <Pair
          rule="A failed load says so; it never borrows empty-state copy."
          good={<ErrorState title="Decks didn't load." onRetry={() => undefined} />}
          bad={<EmptyState title="No decks yet" description="Generate one from your materials." />}
        />
        <Pair
          rule="Status is words plus colour, never colour alone."
          good={
            <div className="flex gap-2">
              <Badge variant="warning">1 missed</Badge>
              <Badge variant="success">Mastered</Badge>
            </div>
          }
          bad={
            <div className="flex gap-2" aria-hidden="true">
              <span className="size-4 rounded-full bg-warning" />
              <span className="size-4 rounded-full bg-tertiary" />
            </div>
          }
        />
        <Pair
          rule="Icons come from lucide, beside a text label. No glyphs or emoji."
          good={
            <Button variant="outline">
              <WrenchIcon data-icon="inline-start" aria-hidden="true" />
              Repair
            </Button>
          }
          bad={<Button variant="outline">Repair &#8594;</Button>}
        />
      </div>
    </ShowcaseSection>
  )
}

/** The Home first viewport, rebuilt from tokens and shared components only. */
export function HomeRecipe() {
  return (
    <ShowcaseSection
      id="recipe"
      title="Recipe: Home"
      description="Exam countdowns lead, weak spots and today's session follow, and the stats sit in one quiet line."
    >
      <div className="flex flex-col gap-6 rounded-3xl bg-surface p-4 ring-1 ring-border sm:p-6">
        <section aria-labelledby="recipe-exams" className="flex flex-col gap-3">
          <SectionHeader id="recipe-exams" title="Exams" action={{ href: "/plan", label: "All plans" }} />
          <div className="grid gap-4 md:grid-cols-3">
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
            />
            <CountdownCard examName="Midterm" courseName="MATH 1920" examDate="2026-10-27T14:00:00Z" timeZone={ZONE} now={NOW} sessionsDone={3} sessionsTotal={12} />
            <CountdownCard examName="Final" courseName="INFO 1300" examDate="2026-12-10T14:00:00Z" timeZone={ZONE} now={NOW} />
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="recipe-weak" className="flex flex-col gap-3">
            <SectionHeader id="recipe-weak" title="Weak spots" action={{ href: "/achievements", label: "All topics" }} />
            <Card>
              <CardContent className="flex flex-col gap-5">
                {[
                  { topic: "Recursion", value: 0.22, errors: 3 },
                  { topic: "Linked lists", value: 0.41, errors: 1 },
                  { topic: "Big-O notation", value: 0.55, errors: 0 },
                ].map((row) => (
                  <div key={row.topic} className="flex items-end gap-4">
                    <MasteryBar label={row.topic} value={row.value} className="flex-1" />
                    {row.errors > 0 ? (
                      <Button variant="outline" size="sm" aria-label={`Repair ${row.topic}`}>
                        <WrenchIcon data-icon="inline-start" aria-hidden="true" />
                        Repair
                      </Button>
                    ) : null}
                  </div>
                ))}
                <p className="flex items-center gap-2 type-body-m text-on-surface-variant">
                  <CircleAlertIcon className="size-4" aria-hidden="true" />
                  4 unresolved errors, mostly misconceptions.
                </p>
              </CardContent>
            </Card>
          </section>

          <section aria-labelledby="recipe-today" className="flex flex-col gap-3">
            <SectionHeader id="recipe-today" title="Today" />
            <Card>
              <CardHeader>
                <CardTitle>Retrieval: Recursion</CardTitle>
                <CardDescription className="tabular-nums">
                  2:00 – 2:30 PM <span aria-hidden="true">·</span> 10 questions
                </CardDescription>
              </CardHeader>
              <CardContent className="type-body-m text-on-surface-variant">
                Topics: Recursion, Base cases, and the call stack.
              </CardContent>
              <CardFooter>
                <Button className="w-full sm:w-auto">
                  <PlayIcon data-icon="inline-start" aria-hidden="true" />
                  Start session
                </Button>
              </CardFooter>
            </Card>
          </section>
        </div>

        <StatLine
          items={[
            { value: "12-day streak", icon: FlameIcon },
            { value: "83%", label: "accuracy", icon: TargetIcon },
            { value: "340 XP", icon: ZapIcon },
          ]}
        />
      </div>
    </ShowcaseSection>
  )
}
