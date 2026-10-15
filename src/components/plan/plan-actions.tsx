"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import {
  CalendarCheckIcon,
  CalendarPlusIcon,
  CalendarSyncIcon,
  CalendarX2Icon,
  CircleAlertIcon,
  DownloadIcon,
  EllipsisVerticalIcon,
  FilePenLineIcon,
  LinkIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react"
import { toast } from "sonner"

import { apiPost } from "@/lib/client-api"
import { plural } from "@/lib/format"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Spinner } from "@/components/ui/spinner"
import { errorCode, errorMessage, readJson } from "@/components/plan/api-errors"
import { isInGoogleCalendar, type CalendarState } from "@/components/plan/calendar-types"
import { DeletePlanDialog } from "@/components/plan/delete-plan-dialog"
import { RescheduleDialog, type RescheduleItem } from "@/components/plan/reschedule-dialog"

interface PublishResponse {
  status: "OK" | "PARTIAL" | "FAILED"
  summary: { created: number; updated: number; unchanged: number; failed: number; total: number }
}

interface CalendarProblem {
  message: string
  code?: string
}

interface PlanActionsValue {
  planId: string
  examName: string
  canReschedule: boolean
  openReschedule: () => void
  calendar: CalendarState
  inGoogleCalendar: boolean
  publishing: boolean
  publish: (options?: { force?: boolean }) => Promise<void>
  problem: CalendarProblem | null
  clearProblem: () => void
}

const PlanActionsContext = React.createContext<PlanActionsValue | null>(null)

function usePlanActions(): PlanActionsValue {
  const value = React.useContext(PlanActionsContext)
  if (!value) throw new Error("Plan actions must sit inside PlanActionsProvider")
  return value
}

/**
 * Holds the plan's interactive state (the reschedule dialog and Google
 * Calendar requests) so the toolbar, the calendar notice and the Reschedule
 * buttons on missed rows share it. Opens the reschedule dialog on load when
 * the URL has ?reschedule=1 (links from Home).
 */
export function PlanActionsProvider({
  planId,
  examName,
  timeZone,
  canReschedule,
  items,
  calendar,
  children,
}: {
  planId: string
  examName: string
  timeZone: string
  canReschedule: boolean
  items: RescheduleItem[]
  calendar: CalendarState
  children: React.ReactNode
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const pathname = usePathname()
  const wantsReschedule = searchParams.get("reschedule") === "1" && canReschedule
  const [rescheduleOpen, setRescheduleOpen] = React.useState(wantsReschedule)
  const [openToken, setOpenToken] = React.useState(0)
  const [publishing, setPublishing] = React.useState(false)
  const [problem, setProblem] = React.useState<CalendarProblem | null>(null)
  const inGoogleCalendar = isInGoogleCalendar(calendar)

  const openReschedule = React.useCallback(() => {
    setOpenToken((n) => n + 1)
    setRescheduleOpen(true)
  }, [])

  const onRescheduleOpenChange = React.useCallback(
    (next: boolean) => {
      setRescheduleOpen(next)
      // Drop ?reschedule=1 so a refresh doesn't reopen it
      if (!next && searchParams.get("reschedule")) {
        const params = new URLSearchParams(searchParams.toString())
        params.delete("reschedule")
        const query = params.toString()
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
      }
    },
    [pathname, router, searchParams]
  )

  const publish = React.useCallback(
    async (options: { force?: boolean } = {}) => {
      setPublishing(true)
      setProblem(null)
      try {
        const result = (await apiPost(`/api/plans/${encodeURIComponent(planId)}/publish/google`, {
          ...(options.force ? { force: true } : {}),
        })) as PublishResponse
        if (result.status === "OK") {
          toast("Added to Google Calendar")
        } else if (result.status === "PARTIAL") {
          const added = result.summary.total - result.summary.failed
          toast(`${added} of ${plural(result.summary.total, { one: "# session", other: "# sessions" })} added to Google Calendar`)
        }
        router.refresh()
      } catch (error) {
        setProblem({
          message: errorMessage(error, "Sessions weren't added to Google Calendar."),
          code: errorCode(error),
        })
      } finally {
        setPublishing(false)
      }
    },
    [planId, router]
  )

  const value = React.useMemo<PlanActionsValue>(
    () => ({
      planId,
      examName,
      canReschedule,
      openReschedule,
      calendar,
      inGoogleCalendar,
      publishing,
      publish,
      problem,
      clearProblem: () => setProblem(null),
    }),
    [planId, examName, canReschedule, openReschedule, calendar, inGoogleCalendar, publishing, publish, problem]
  )

  return (
    <PlanActionsContext.Provider value={value}>
      {children}
      {canReschedule ? (
        <RescheduleDialog
          open={rescheduleOpen}
          onOpenChange={onRescheduleOpenChange}
          openToken={openToken}
          planId={planId}
          examName={examName}
          timeZone={timeZone}
          items={items}
          inGoogleCalendar={inGoogleCalendar}
        />
      ) : null}
    </PlanActionsContext.Provider>
  )
}

/** "Reschedule" on a missed session's row; opens the same preview as the toolbar. */
export function RescheduleRowButton({ sessionLabel }: { sessionLabel: string }) {
  const { openReschedule } = usePlanActions()
  return (
    <Button variant="outline" size="sm" onClick={openReschedule}>
      <CalendarSyncIcon data-icon="inline-start" aria-hidden="true" />
      Reschedule
      <span className="sr-only"> missed session: {sessionLabel}</span>
    </Button>
  )
}

async function downloadIcs(planId: string) {
  const res = await fetch(`/api/plans/${encodeURIComponent(planId)}/ics`)
  if (!res.ok) await readJson(res)
  const blob = await res.blob()
  const disposition = res.headers.get("Content-Disposition") ?? ""
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "study-plan.ics"
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The plan's actions: Reschedule sessions, Add to Google Calendar (or its
 * status), Export calendar (.ics), and a menu with the Google Calendar
 * options, Replace plan and Delete plan.
 */
export function PlanToolbar({
  courseName,
  upcomingCount,
  totalSessions,
}: {
  courseName: string
  /** Sessions still to do, for the delete confirmation. */
  upcomingCount: number
  totalSessions: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { planId, examName, canReschedule, openReschedule, calendar, inGoogleCalendar, publishing, publish } =
    usePlanActions()
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [removeOpen, setRemoveOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)

  const connected = calendar.connection === "connected"
  const canAdd = calendar.configured && connected && !inGoogleCalendar

  async function exportCalendar() {
    setExporting(true)
    try {
      await downloadIcs(planId)
      toast("Calendar file exported")
    } catch (error) {
      toast(errorMessage(error, "Calendar file not exported."), {
        action: { label: "Retry", onClick: () => void exportCalendar() },
      })
    } finally {
      setExporting(false)
    }
  }

  async function removeFromGoogle() {
    // A failed request throws, and the dialog stays open with its message
    const result = (await apiPost(`/api/plans/${encodeURIComponent(planId)}/unpublish/google`, {})) as {
      deleted: number
      failed: number
    }
    router.refresh()
    if (result.failed > 0) {
      toast(
        `${result.failed} of ${plural(result.deleted + result.failed, { one: "# event", other: "# events" })} weren't removed from Google Calendar. Retry from the plan menu.`
      )
    } else {
      toast("Removed from Google Calendar")
    }
  }

  async function deletePlan({ removeCalendarEvents }: { removeCalendarEvents: boolean }) {
    const query = removeCalendarEvents ? "?calendar=remove" : ""
    try {
      const res = await fetch(`/api/plans/${encodeURIComponent(planId)}${query}`, { method: "DELETE" })
      if (res.status !== 404) await readJson(res)
    } catch (error) {
      throw new Error(errorMessage(error, "Plan not deleted."))
    }
    toast(`${examName} plan deleted`)
    if (searchParams.get("plan")) router.replace(pathname)
    else router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canReschedule ? (
        <Button variant="outline" onClick={openReschedule}>
          <CalendarSyncIcon data-icon="inline-start" aria-hidden="true" />
          Reschedule sessions
        </Button>
      ) : null}

      {canAdd ? (
        <Button variant="secondary" onClick={() => void publish()} disabled={publishing}>
          {publishing ? (
            <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
          ) : (
            <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
          )}
          {publishing ? "Adding to Google Calendar…" : "Add to Google Calendar"}
        </Button>
      ) : null}

      {inGoogleCalendar && calendar.publication?.status === "PUBLISHED" ? (
        <Badge variant="success" className="h-8 px-3">
          <CalendarCheckIcon data-icon="inline-start" aria-hidden="true" />
          In Google Calendar
        </Badge>
      ) : null}

      <Button variant="outline" onClick={exportCalendar} disabled={exporting}>
        {exporting ? (
          <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
        ) : (
          <DownloadIcon data-icon="inline-start" aria-hidden="true" />
        )}
        {exporting ? "Exporting…" : "Export calendar (.ics)"}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={`More actions for the ${examName} plan`}>
            <EllipsisVerticalIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {inGoogleCalendar ? (
            <DropdownMenuGroup>
              <DropdownMenuItem disabled={publishing || !connected} onSelect={() => void publish()}>
                <RefreshCwIcon aria-hidden="true" />
                Update Google Calendar
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!connected} onSelect={() => setRemoveOpen(true)}>
                <CalendarX2Icon aria-hidden="true" />
                Remove from Google Calendar
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : calendar.configured && !connected ? (
            <DropdownMenuGroup>
              <DropdownMenuItem asChild>
                <Link href="/settings#calendar">
                  <LinkIcon aria-hidden="true" />
                  {calendar.connection === "reconnect" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
                </Link>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          ) : null}
          {calendar.configured && (inGoogleCalendar || !connected) ? <DropdownMenuSeparator /> : null}
          <DropdownMenuGroup>
            <DropdownMenuItem asChild>
              <Link href={`/plan/new?replace=${encodeURIComponent(planId)}`}>
                <FilePenLineIcon aria-hidden="true" />
                Replace plan
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
              <Trash2Icon aria-hidden="true" />
              Delete plan
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DeletePlanDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        examName={examName}
        upcomingCount={upcomingCount}
        inGoogleCalendar={inGoogleCalendar}
        onConfirm={deletePlan}
      />

      <ConfirmDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove the ${courseName} ${examName} sessions from Google Calendar?`}
        description={`This deletes the plan's ${plural(calendar.publication?.added ?? totalSessions, {
          one: "# event",
          other: "# events",
        })} from Google Calendar. The plan and its sessions stay here.`}
        confirmLabel="Remove events"
        pendingLabel="Removing events…"
        failedMessage="Events not removed. Check your connection and retry."
        onConfirm={removeFromGoogle}
      />
    </div>
  )
}

/**
 * Google Calendar problems that need the student: a partial or failed add
 * (read from the server, so it survives a reload), a sign-in that expired,
 * or the last request's error with its fix.
 */
export function CalendarNotice() {
  const { calendar, inGoogleCalendar, problem, clearProblem, publish, publishing } = usePlanActions()
  const publication = calendar.publication

  if (problem) {
    const reconnect = problem.code === "GOOGLE_RECONNECT_REQUIRED" || problem.code === "GOOGLE_NOT_CONNECTED"
    const otherCalendar = problem.code === "ALREADY_PUBLISHED_DIFFERENT_CALENDAR"
    return (
      <Alert variant={reconnect ? "warning" : "destructive"}>
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>{problem.message}</AlertTitle>
        <AlertDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {reconnect ? (
              <Button asChild size="sm" variant="outline">
                <Link href="/settings#calendar">
                  {problem.code === "GOOGLE_NOT_CONNECTED" ? "Connect Google Calendar" : "Reconnect Google Calendar"}
                </Link>
              </Button>
            ) : otherCalendar ? (
              <Button size="sm" variant="outline" onClick={() => void publish({ force: true })} disabled={publishing}>
                Add here anyway
              </Button>
            ) : (
              <Button size="sm" variant="outline" onClick={() => void publish()} disabled={publishing}>
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
                Retry
              </Button>
            )}
            <Button size="sm" variant="text" onClick={clearProblem}>
              Dismiss
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (publication && inGoogleCalendar && calendar.connection === "reconnect") {
    return (
      <Alert variant="warning">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>Google Calendar needs you to sign in again.</AlertTitle>
        <AlertDescription>
          Until then, changes to this plan don&apos;t reach Google Calendar.
          <div className="mt-2">
            <Button asChild size="sm" variant="outline">
              <Link href="/settings#calendar">Reconnect Google Calendar</Link>
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (publication?.status === "PARTIAL") {
    const missing = Math.max(0, publication.total - publication.added)
    return (
      <Alert variant="warning" role="status">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>
          {publication.added} of {plural(publication.total, { one: "# session", other: "# sessions" })} added to Google
          Calendar.
        </AlertTitle>
        <AlertDescription>
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void publish()}
              disabled={publishing || calendar.connection !== "connected"}
            >
              {publishing ? (
                <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
              ) : (
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {publishing
                ? "Adding to Google Calendar…"
                : plural(missing, { one: "Retry # session", other: "Retry # sessions" })}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  if (publication?.status === "FAILED") {
    return (
      <Alert variant="destructive" role="status">
        <CircleAlertIcon aria-hidden="true" />
        <AlertTitle>Sessions weren&apos;t added to Google Calendar.</AlertTitle>
        <AlertDescription>
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void publish()}
              disabled={publishing || calendar.connection !== "connected"}
            >
              {publishing ? (
                <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
              ) : (
                <RotateCcwIcon data-icon="inline-start" aria-hidden="true" />
              )}
              {publishing ? "Adding to Google Calendar…" : "Retry"}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    )
  }

  return null
}
