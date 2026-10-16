"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import useSWR from "swr"
import { ArrowRightIcon, CalendarCheckIcon, CircleAlertIcon, CircleSlashIcon } from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/client-api"
import { formatDateWeekday, formatTimeRange, plural } from "@/lib/format"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { errorCode, errorMessage } from "@/components/plan/api-errors"
import { modeLabel, previewSentence, rescheduleToast, type RescheduleApplyResult } from "@/components/plan/plan-model"
import type { ReturnFocus } from "@/components/plan/use-return-focus"

export interface RescheduleItem {
  id: string
  mode: string
  topics: string[]
  /** The plan's state for it, so only sessions shown as missed get the badge. */
  state: string
}

interface Slot {
  dayIndex: number
  startTime: string
  endTime: string
}

interface PreviewChange {
  itemId: string
  action: "MOVED" | "DROPPED" | "KEPT"
  before: Slot | null
  after: Slot | null
  missed?: boolean
}

interface Preview {
  changes: PreviewChange[]
  summary: { moved: number; kept: number; dropped: number }
}

const BODY = { reason: "missed_sessions", include_missed: true }

function previewFetcher(url: string): Promise<Preview> {
  return apiPost(url, BODY) as Promise<Preview>
}

function slotText(slot: Slot, timeZone: string) {
  return `${formatDateWeekday(slot.startTime, { timeZone })}, ${formatTimeRange(slot.startTime, slot.endTime, { timeZone })}`
}

function ChangeRow({
  change,
  item,
  timeZone,
}: {
  change: PreviewChange
  item: RescheduleItem | undefined
  timeZone: string
}) {
  const label = modeLabel(item?.mode ?? "")
  const from = change.before ? slotText(change.before, timeZone) : null
  const to = change.after ? slotText(change.after, timeZone) : null

  return (
    <li className="flex flex-col gap-1 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="type-title-s text-on-surface">{label}</span>
        {change.missed && item?.state === "missed" ? <Badge variant="warning">Missed</Badge> : null}
      </div>
      {item && item.topics.length > 0 ? (
        <p className="truncate type-body-s text-on-surface-variant">{item.topics.join(", ")}</p>
      ) : null}
      {change.action === "MOVED" && from && to ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 type-body-m tabular-nums text-on-surface-variant">
          <span className="sr-only">Moves from </span>
          <span className="line-through decoration-1">{from}</span>
          <ArrowRightIcon className="size-4 shrink-0" aria-hidden="true" />
          <span className="sr-only"> to </span>
          <span className="text-on-surface">{to}</span>
        </p>
      ) : from ? (
        <p className="type-body-m tabular-nums text-on-surface-variant">
          <span className="sr-only">Was </span>
          {from}
        </p>
      ) : null}
    </li>
  )
}

/**
 * Reschedule sessions: fetches a preview the moment it opens (nothing moves
 * yet), lists each move and each session that will be skipped, asks whether
 * to update Google Calendar when the plan is there, then applies.
 */
export function RescheduleDialog({
  open,
  onOpenChange,
  openToken,
  planId,
  examName,
  timeZone,
  items,
  inGoogleCalendar,
  onUpdateCalendar,
  returnFocus,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Changes on every opening, so each opening gets a fresh preview. */
  openToken: number
  planId: string
  examName: string
  timeZone: string
  items: RescheduleItem[]
  inGoogleCalendar: boolean
  /** Adds the plan to Google Calendar again (the plan menu's Update Google Calendar). */
  onUpdateCalendar: () => void
  /** Where focus goes when the dialog closes; it has no trigger of its own. */
  returnFocus: ReturnFocus
}) {
  const router = useRouter()
  const url = `/api/plans/${encodeURIComponent(planId)}/reflow/preview`
  const { data, error, isValidating, mutate } = useSWR(
    open ? ([url, openToken] as const) : null,
    ([key]) => previewFetcher(key),
    { revalidateOnFocus: false, revalidateIfStale: false, shouldRetryOnError: false, dedupingInterval: 0 }
  )
  const [updateCalendar, setUpdateCalendar] = React.useState(true)
  const [applying, setApplying] = React.useState(false)
  const [applyError, setApplyError] = React.useState<string | null>(null)
  const calendarFieldId = React.useId()

  const itemById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items])
  const moves = data?.changes.filter((c) => c.action === "MOVED") ?? []
  const drops = data?.changes.filter((c) => c.action === "DROPPED") ?? []
  const nothingToDo = data ? moves.length === 0 && drops.length === 0 : false
  const loading = open && !data && !error

  function handleOpenChange(next: boolean) {
    if (applying) return
    if (!next) {
      setApplyError(null)
      setUpdateCalendar(true)
    }
    onOpenChange(next)
  }

  async function apply() {
    if (!data || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      const result = (await apiPost(`/api/plans/${encodeURIComponent(planId)}/reflow/apply`, {
        ...BODY,
        calendar_update: inGoogleCalendar && updateCalendar ? "REPUBLISH" : "NONE",
      })) as RescheduleApplyResult

      const message = rescheduleToast(result)
      setApplying(false)
      // A missed row's Reschedule button leaves once its session moves, so
      // focus goes to the toolbar's Reschedule sessions button instead
      if (result.applied) returnFocus.remember(null)
      onOpenChange(false)
      setUpdateCalendar(true)
      toast(message.title, {
        description: message.description,
        // A calendar step to take stays until it is dismissed
        duration: message.calendarAction ? Infinity : undefined,
        action:
          message.calendarAction === "update"
            ? { label: "Update Google Calendar", onClick: onUpdateCalendar }
            : message.calendarAction === "reconnect"
              ? { label: "Reconnect Google Calendar", onClick: () => router.push("/settings#calendar") }
              : undefined,
      })
      router.refresh()
    } catch (err) {
      setApplying(false)
      setApplyError(errorMessage(err, "Sessions not moved."))
    }
  }

  const reconnect = errorCode(error) === "GOOGLE_RECONNECT_REQUIRED"
  const confirmLabel =
    moves.length > 0
      ? plural(moves.length, { one: "Move # session", other: "Move # sessions" })
      : plural(drops.length, { one: "Skip # session", other: "Skip # sessions" })

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="flex max-h-[min(90dvh,48rem)] flex-col gap-0 p-0 sm:max-w-xl"
        onCloseAutoFocus={returnFocus.onCloseAutoFocus}
      >
        <DialogHeader className="px-6 pt-6 pr-16 pb-4">
          <DialogTitle>Reschedule sessions</DialogTitle>
          <DialogDescription>
            Missed sessions move into free time before {examName}. The others keep their times while they still fit.
            Nothing changes until you confirm.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-2">
          {loading ? (
            <LoadingRegion label="Finding new times…" className="flex flex-col gap-4 py-2">
              <p className="type-body-m text-on-surface-variant" aria-hidden="true">
                Finding new times…
              </p>
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex flex-col gap-2" aria-hidden="true">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3.5 w-3/4" />
                </div>
              ))}
            </LoadingRegion>
          ) : error && !data ? (
            <div className="flex flex-col gap-3 py-2">
              <ErrorState
                title="New times weren't found."
                description={errorMessage(error, "The preview didn't load.")}
                onRetry={() => void mutate()}
                retrying={isValidating}
              />
              {reconnect ? (
                <Button asChild variant="outline" className="self-start">
                  <Link href="/settings#calendar">Reconnect Google Calendar</Link>
                </Button>
              ) : null}
            </div>
          ) : nothingToDo ? (
            <div role="status" className="flex items-start gap-3 rounded-2xl bg-surface-container px-4 py-3">
              <CalendarCheckIcon className="mt-0.5 size-5 shrink-0 text-tertiary" aria-hidden="true" />
              <div className="flex flex-col gap-0.5">
                <p className="type-title-s text-on-surface">Nothing to reschedule</p>
                <p className="type-body-m text-on-surface-variant">Every session already fits before {examName}.</p>
              </div>
            </div>
          ) : data ? (
            <div className="flex flex-col gap-4">
              <p role="status" className="type-body-l text-on-surface">
                {previewSentence(data.summary, examName)}
              </p>

              {moves.length > 0 ? (
                <section aria-labelledby="reschedule-moves" className="flex flex-col">
                  <h3 id="reschedule-moves" className="type-title-s text-on-surface">
                    New times
                  </h3>
                  <ul className="flex flex-col divide-y divide-outline-variant">
                    {moves.map((change) => (
                      <ChangeRow
                        key={change.itemId}
                        change={change}
                        item={itemById.get(change.itemId)}
                        timeZone={timeZone}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {drops.length > 0 ? (
                <section aria-labelledby="reschedule-drops" className="flex flex-col gap-2">
                  <h3 id="reschedule-drops" className="flex items-center gap-2 type-title-s text-on-surface">
                    <CircleSlashIcon className="size-4" aria-hidden="true" />
                    Skipped
                  </h3>
                  <p className="type-body-m text-on-surface-variant">
                    There&apos;s no free time left for these before {examName}, within your study hours and daily
                    limit. They stay on the plan, marked Skipped.
                  </p>
                  <ul className="flex flex-col divide-y divide-outline-variant">
                    {drops.map((change) => (
                      <ChangeRow
                        key={change.itemId}
                        change={change}
                        item={itemById.get(change.itemId)}
                        timeZone={timeZone}
                      />
                    ))}
                  </ul>
                </section>
              ) : null}

              {inGoogleCalendar ? (
                <Field orientation="horizontal" className="rounded-2xl bg-surface-container px-4 py-3">
                  <Checkbox
                    id={calendarFieldId}
                    checked={updateCalendar}
                    onCheckedChange={(value) => setUpdateCalendar(value === true)}
                    disabled={applying}
                  />
                  <FieldContent>
                    <FieldLabel htmlFor={calendarFieldId}>Also update these sessions in Google Calendar</FieldLabel>
                    <FieldDescription>
                      Left unchecked, Google Calendar keeps the old times until you update it from the plan.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              ) : null}
            </div>
          ) : null}

          {applyError ? (
            <p role="alert" className="mt-3 flex items-start gap-2 type-body-m text-error">
              <CircleAlertIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {applyError}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-outline-variant px-6 py-4">
          <DialogClose asChild>
            <Button variant="text" disabled={applying}>
              {nothingToDo ? "Close" : "Cancel"}
            </Button>
          </DialogClose>
          {data && !nothingToDo ? (
            <Button onClick={apply} disabled={applying}>
              {applying ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
              {applying ? "Moving sessions…" : confirmLabel}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
