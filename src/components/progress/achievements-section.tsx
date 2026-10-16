import { CheckCheckIcon, FlameIcon, LayersIcon, ZapIcon } from "lucide-react"

import { ProgressLinear } from "@/components/app/progress-linear"
import { SectionHeader } from "@/components/app/section-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  achievementGroups,
  achievementViews,
  type AchievementView,
} from "@/lib/progress-model"
import { SectionError } from "@/components/progress/section-error"
import { loadGameState, loadSafely } from "@/services/progress-data"
import { TOTAL_BADGES } from "@/lib/badge-data"
import { cn } from "@/lib/utils"
import { formatDate, formatNumber } from "@/lib/format"

const HEADING_ID = "progress-achievements"

function AchievementIcon({ view }: { view: AchievementView }) {
  const props = { className: "size-5", "aria-hidden": true } as const
  if (view.key === "FIRST_PERFECT") return <CheckCheckIcon {...props} />
  switch (view.category) {
    case "streak":
      return <FlameIcon {...props} />
    case "review":
      return <LayersIcon {...props} />
    default:
      return <ZapIcon {...props} />
  }
}

function AchievementRow({ view, timeZone }: { view: AchievementView; timeZone: string }) {
  const earned = view.earnedAt !== null
  return (
    <li className="flex items-start gap-4 py-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          earned
            ? "bg-tertiary-container text-on-tertiary-container"
            : "bg-surface-container-high text-on-surface-variant"
        )}
      >
        <AchievementIcon view={view} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <h4 className="type-title-s text-on-surface">{view.label}</h4>
          {earned ? (
            <Badge variant="success">Earned {formatDate(view.earnedAt ?? "", { timeZone })}</Badge>
          ) : null}
        </div>
        <p className="type-body-m text-on-surface-variant">{view.description}</p>
        {earned ? null : (
          <div className="mt-1 flex items-center gap-3">
            <ProgressLinear
              className="flex-1"
              value={(view.current / view.threshold) * 100}
              label={`${view.label} progress`}
              valueText={view.progressText}
            />
            <span className="shrink-0 type-label-m text-on-surface-variant tabular-nums">{view.progressText}</span>
          </div>
        )}
      </div>
    </li>
  )
}

export async function AchievementsSection({ userId }: { userId: string }) {
  const game = await loadSafely("progress.achievements_failed", userId, () => loadGameState(userId))
  const views = game
    ? achievementViews(
        {
          streak: game.streak,
          xp: game.xpTotal,
          reviews: game.reviewCount,
          perfectDecks: game.perfectDeckCount,
        },
        game.achievements
      )
    : []
  const earnedCount = views.filter((v) => v.earnedAt !== null).length

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3">
      <SectionHeader
        id={HEADING_ID}
        title="Achievements"
        description={
          !game
            ? undefined
            : earnedCount === 0
              ? "No achievements yet. The first comes with a 3-day streak or your first card review."
              : `${formatNumber(earnedCount)} of ${formatNumber(TOTAL_BADGES)} earned.`
        }
      />
      {game ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {achievementGroups(views).map((group) => (
            <Card key={group.key} className="min-w-0">
              <CardHeader>
                <CardTitle>
                  <h3>{group.label}</h3>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul role="list" className="-my-3 flex flex-col divide-y divide-border">
                  {group.items.map((view) => (
                    <AchievementRow key={view.key} view={view} timeZone={game.timeZone} />
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <SectionError title="Achievements didn't load." />
      )}
    </section>
  )
}
