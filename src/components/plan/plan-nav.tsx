import Link from "next/link"
import { CheckIcon, FolderOpenIcon, PlusIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { examRelative, keyOf, type PlanSummary } from "@/components/plan/plan-model"

type NavPlan = Pick<PlanSummary, "plan_id" | "course_name" | "exam_name" | "exam_date">

/**
 * The Plan area's own navigation, like the side panel of Google Calendar:
 * New plan, the student's plans (soonest exam first), and Materials. At
 * 1200px and up it is a column beside the content; below that it becomes a
 * row of buttons and a scrolling row of plan chips, where the section or
 * plan on screen is marked with a check and a tonal fill.
 */
export function PlanNav({
  plans,
  selectedPlanId,
  section,
  timeZone,
  now = new Date(),
}: {
  plans: readonly NavPlan[]
  /** The plan on screen, marked aria-current. */
  selectedPlanId?: string | null
  section: "plan" | "materials" | "new"
  timeZone: string
  now?: Date
}) {
  const todayKey = keyOf(now, timeZone)

  return (
    <>
      {/* Expanded: side column */}
      <aside
        aria-label="Plans and materials"
        className="hidden w-64 shrink-0 flex-col gap-4 lg:sticky lg:top-[calc(var(--app-bar-height)+0.5rem)] lg:flex lg:-m-1 lg:max-h-[calc(100dvh-var(--app-bar-height)-1rem)] lg:overflow-y-auto lg:p-1"
      >
        <Button asChild variant="secondary" size="lg" className="self-start">
          <Link href="/plan/new" aria-current={section === "new" ? "page" : undefined}>
            <PlusIcon data-icon="inline-start" aria-hidden="true" />
            New plan
          </Link>
        </Button>

        {plans.length > 0 ? (
          <nav aria-labelledby="plan-nav-heading" className="flex flex-col gap-1">
            <h2 id="plan-nav-heading" className="px-4 pt-2 pb-1 type-title-s text-on-surface-variant">
              Plans
            </h2>
            <ul className="flex flex-col gap-0.5">
              {plans.map((plan) => {
                const active = section === "plan" && plan.plan_id === selectedPlanId
                const past = plan.exam_date < todayKey
                return (
                  <li key={plan.plan_id}>
                    <Link
                      href={`/plan?plan=${encodeURIComponent(plan.plan_id)}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "state-layer relative isolate flex min-h-14 items-center gap-3 rounded-full px-4 py-2",
                        active
                          ? "bg-secondary-container text-on-secondary-container forced-colors:outline-2 forced-colors:outline-[Highlight]"
                          : "text-on-surface-variant hover:text-on-surface"
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("truncate type-label-l", active ? "" : "text-on-surface")}>
                          {plan.course_name}
                        </span>
                        <span className="truncate type-body-s">{plan.exam_name}</span>
                      </span>
                      <span className={cn("shrink-0 type-label-m tabular-nums", past && "opacity-80")}>
                        {examRelative(plan.exam_date, todayKey)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}

        <Separator />

        <Link
          href="/plan/materials"
          aria-current={section === "materials" ? "page" : undefined}
          className={cn(
            "state-layer relative isolate flex h-14 items-center gap-3 rounded-full px-4 type-label-l",
            section === "materials"
              ? "bg-secondary-container text-on-secondary-container forced-colors:outline-2 forced-colors:outline-[Highlight]"
              : "text-on-surface-variant hover:text-on-surface"
          )}
        >
          <FolderOpenIcon className="size-5 shrink-0" aria-hidden="true" />
          Materials
        </Link>
      </aside>

      {/* Compact and medium: New plan and Materials, then plan chips. The
          section on screen gets the selected chip look (check icon, tonal
          fill) like the plan chips; the others are outlined. */}
      <div className="flex min-w-0 flex-col gap-3 lg:hidden">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant={section === "new" ? "secondary" : "outline"}>
            <Link href="/plan/new" aria-current={section === "new" ? "page" : undefined}>
              {section === "new" ? (
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
              ) : (
                <PlusIcon data-icon="inline-start" aria-hidden="true" />
              )}
              New plan
            </Link>
          </Button>
          <Button asChild variant={section === "materials" ? "secondary" : "outline"}>
            <Link href="/plan/materials" aria-current={section === "materials" ? "page" : undefined}>
              {section === "materials" ? (
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
              ) : (
                <FolderOpenIcon data-icon="inline-start" aria-hidden="true" />
              )}
              Materials
            </Link>
          </Button>
        </div>
        {plans.length > 1 || (plans.length === 1 && section !== "plan") ? (
          <nav aria-label="Plans" className="-mx-4 -my-1 overflow-x-auto px-4 py-1 sm:-mx-6 sm:px-6 md:-mx-8 md:px-8">
            <ul className="flex w-max gap-2">
              {plans.map((plan) => {
                const active = section === "plan" && plan.plan_id === selectedPlanId
                return (
                  <li key={plan.plan_id}>
                    <Link
                      href={`/plan?plan=${encodeURIComponent(plan.plan_id)}`}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "state-layer relative isolate inline-flex h-8 items-center gap-2 rounded-md border px-3 type-label-l whitespace-nowrap",
                        active
                          ? "border-transparent bg-secondary-container text-on-secondary-container"
                          : "border-outline-variant text-on-surface-variant"
                      )}
                    >
                      {active ? <CheckIcon className="size-4" aria-hidden="true" /> : null}
                      {plan.course_name} {plan.exam_name}
                      <span className="sr-only">, exam {examRelative(plan.exam_date, todayKey)}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        ) : null}
      </div>
    </>
  )
}
