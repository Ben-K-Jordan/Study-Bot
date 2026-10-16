import Link from "next/link"
import { ChevronRightIcon, FlameIcon, ZapIcon } from "lucide-react"

import { ProgressLinear } from "@/components/app/progress-linear"
import { SectionHeader } from "@/components/app/section-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { SectionError } from "@/components/progress/section-error"
import { loadGameState, loadSafely } from "@/services/progress-data"
import { UseFreezeButton } from "@/components/progress/use-freeze-button"
import { formatNumber, plural } from "@/lib/format"
import { MAX_STREAK_FREEZES, XP_AMOUNTS, type GameState } from "@/services/gamification"

const HEADING_ID = "progress-streak-xp"

function streakStatus(game: GameState): string {
  if (game.activeToday) return "Today counts. Study tomorrow to keep it going."
  if (game.freezeUsedToday) return "A freeze covers today, so your streak continues tomorrow."
  if (game.streak > 0) return "Study today to keep it going."
  return "Study today to start one."
}

function StreakCard({ game }: { game: GameState }) {
  const canFreeze = game.streakFreezes > 0 && game.streak > 0 && !game.activeToday && !game.freezeUsedToday
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FlameIcon className="size-5 text-on-surface-variant" aria-hidden="true" />
          <h3>Streak</h3>
        </CardTitle>
        <CardDescription>Days in a row with a finished session or a card review.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="type-headline-m text-on-surface">
            {plural(game.streak, { zero: "No streak", one: "#-day streak", other: "#-day streak" })}
          </p>
          <p role="status" className="type-body-m text-on-surface-variant">
            {streakStatus(game)}
          </p>
        </div>
        {/* Freezes stay out of sight until the student has one to spend. */}
        {game.streakFreezes > 0 ? (
          <div className="flex flex-col gap-3 rounded-xl bg-surface-container p-4">
            <p className="type-title-s text-on-surface tabular-nums">
              {plural(game.streakFreezes, { one: "# streak freeze", other: "# streak freezes" })}
            </p>
            <p className="type-body-m text-on-surface-variant">
              A freeze counts a day without study as a study day, so one day off doesn&apos;t end your streak.
              You earn one for every 7 days of streak, up to {formatNumber(MAX_STREAK_FREEZES)}.
            </p>
            {canFreeze ? <UseFreezeButton /> : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function XpCard({ game }: { game: GameState }) {
  const goal = Math.max(1, game.dailyXpGoal)
  const todayText = `${formatNumber(game.xpToday)} of ${formatNumber(goal)} XP today`
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ZapIcon className="size-5 text-on-surface-variant" aria-hidden="true" />
          <h3>Daily XP goal</h3>
        </CardTitle>
        <CardDescription>
          A finished session earns {formatNumber(XP_AMOUNTS.SESSION_COMPLETED)} XP and a card review{" "}
          {formatNumber(XP_AMOUNTS.FLASHCARD_REVIEW)} XP.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="type-headline-m text-on-surface tabular-nums">{todayText}</p>
        <ProgressLinear
          value={Math.min(100, (game.xpToday / goal) * 100)}
          label="Daily XP goal"
          valueText={todayText}
          tone={game.xpToday >= goal ? "tertiary" : "primary"}
        />
        <p className="type-body-m text-on-surface-variant tabular-nums">
          {game.xpToday >= goal ? "Goal reached today. " : ""}
          {formatNumber(game.xpTotal)} XP in total.
        </p>
      </CardContent>
      <CardFooter>
        <Button asChild variant="text" size="sm" className="-ml-3">
          <Link href="/settings#study">
            Change daily XP goal
            <ChevronRightIcon data-icon="inline-end" aria-hidden="true" />
          </Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

export async function StreakXpSection({ userId }: { userId: string }) {
  const game = await loadSafely("progress.game_failed", userId, () => loadGameState(userId))
  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionHeader id={HEADING_ID} title="Streak and XP" />
      {game ? (
        <div className="grid gap-4 md:grid-cols-2">
          <StreakCard game={game} />
          <XpCard game={game} />
        </div>
      ) : (
        <SectionError title="Your streak and XP didn't load." />
      )}
    </section>
  )
}
