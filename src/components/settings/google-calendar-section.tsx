"use client"

import { useRef, useState } from "react"
import { CalendarPlusIcon, CheckIcon, InfoIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react"
import type { KeyedMutator } from "swr"

import type { GoogleStatus } from "@/services/google-status"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { apiPost, ApiError } from "@/lib/client-api"
import { GOOGLE_COPY } from "@/lib/google/messages"
import { useApi } from "@/lib/swr"
import { failureMessage } from "./request"
import { SettingsRow, SettingsRows, SettingsSection } from "./settings-section"

const CONNECT_URL = "/api/integrations/google/connect"
const STATUS_URL = "/api/integrations/google/status"
const CALENDARS_URL = "/api/integrations/google/calendars"

interface GoogleCalendar {
  id: string
  summary: string
  primary?: boolean
  accessRole?: string
}

interface CalendarsResponse {
  calendars: GoogleCalendar[]
  selected: string
}

/**
 * Google Calendar: connection status, Connect, Reconnect and Disconnect
 * (confirmed), the calendar that receives sessions, and the calendars new
 * plans treat as busy time. On a server without Google credentials the
 * page leaves this section out, except in development, where it says why.
 */
export function GoogleCalendarSection({
  initial,
  configured,
  dev,
}: {
  initial: GoogleStatus | null
  configured: boolean
  dev: boolean
}) {
  return (
    <SettingsSection
      id="calendar"
      title="Google Calendar"
      description="Add your plan's sessions to Google Calendar, and let new plans work around the times you're busy."
    >
      {configured ? (
        <CalendarConnection initial={initial} />
      ) : (
        <Alert role="status">
          <InfoIcon aria-hidden="true" />
          <AlertTitle>Google Calendar isn&apos;t set up on this server.</AlertTitle>
          {dev ? (
            <AlertDescription>
              Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env, then restart the server. This
              note shows only in development.
            </AlertDescription>
          ) : null}
        </Alert>
      )}
    </SettingsSection>
  )
}

function CalendarConnection({ initial }: { initial: GoogleStatus | null }) {
  const { data: status, error, isLoading, isValidating, mutate } = useApi<GoogleStatus>(STATUS_URL, {
    fallbackData: initial ?? undefined,
    revalidateOnMount: !initial,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // After a disconnect the Disconnect button is gone, so the dialog hands
  // focus to Connect as it closes and keyboard users aren't dropped at the top.
  const connectRef = useRef<HTMLAnchorElement>(null)
  const connected = status?.connected ?? false

  async function disconnect() {
    await apiPost("/api/integrations/google/disconnect", {})
    await mutate()
    setNotice("Google Calendar disconnected")
  }

  let body: React.ReactNode
  if (!status) {
    body =
      error && !isLoading ? (
        <ErrorState
          title="Google Calendar status didn't load."
          onRetry={() => void mutate()}
          retrying={isValidating}
        />
      ) : (
        <LoadingRegion label="Loading Google Calendar status…" className="flex flex-col gap-3">
          <Skeleton aria-hidden="true" className="h-4 w-40" />
          <Skeleton aria-hidden="true" className="h-10 w-56 rounded-full" />
        </LoadingRegion>
      )
  } else if (status.connected) {
    body = (
      <SettingsRows>
        <SettingsRow title="Connected account" titleId="calendar-account-title">
          <div className="flex flex-col gap-3 @md:flex-row @md:items-center @md:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="type-body-l break-all text-on-surface">
                {status.connected_email ?? "Google account"}
              </span>
              <Badge variant="success">
                <CheckIcon data-icon="inline-start" aria-hidden="true" />
                Connected
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              className="self-start @md:self-auto"
              onClick={() => setConfirmOpen(true)}
            >
              Disconnect
            </Button>
          </div>
        </SettingsRow>
        <CalendarChoices status={status} mutateStatus={mutate} />
      </SettingsRows>
    )
  } else if (status.needs_reconnect) {
    body = (
      <div className="flex flex-col gap-4">
        <Alert variant="warning" role="status">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertTitle>{GOOGLE_COPY.reconnect}</AlertTitle>
          <AlertDescription>
            {status.connected_email
              ? `Google stopped accepting Study Bot's access to ${status.connected_email}. Reconnect to keep adding sessions and checking busy times.`
              : "Google stopped accepting Study Bot's access. Reconnect to keep adding sessions and checking busy times."}
          </AlertDescription>
        </Alert>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <a href={CONNECT_URL} ref={connectRef}>
              <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
              Reconnect Google Calendar
            </a>
          </Button>
          {status.status === "ERROR" ? (
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(true)}>
              Disconnect
            </Button>
          ) : null}
        </div>
      </div>
    )
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <Badge variant="outline">Not connected</Badge>
          <p className="mt-2 type-body-m text-on-surface-variant">
            Google asks you to let Study Bot add events to your calendar and see when you&apos;re busy.
          </p>
        </div>
        <Button asChild className="self-start">
          <a href={CONNECT_URL} ref={connectRef}>
            <CalendarPlusIcon data-icon="inline-start" aria-hidden="true" />
            Connect Google Calendar
          </a>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {body}
      <p role="status" className="empty:hidden flex items-center gap-1.5 type-body-m text-on-surface-variant">
        {notice && !connected ? (
          <>
            <CheckIcon className="size-4 text-tertiary" aria-hidden="true" />
            {notice}
          </>
        ) : null}
      </p>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Disconnect Google Calendar?"
        description="Study Bot stops adding sessions to Google Calendar and stops checking it for busy times. Events already in Google Calendar stay there."
        confirmLabel="Disconnect Google Calendar"
        pendingLabel="Disconnecting…"
        destructive={false}
        failedMessage="Google Calendar not disconnected. Check your connection and retry."
        returnFocus={connectRef}
        onConfirm={disconnect}
      />
    </div>
  )
}

type SaveState =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string }

function CalendarChoices({
  status,
  mutateStatus,
}: {
  status: GoogleStatus
  mutateStatus: KeyedMutator<GoogleStatus>
}) {
  const { data, error, isLoading, isValidating, mutate } = useApi<CalendarsResponse>(CALENDARS_URL)
  const [save, setSave] = useState<SaveState>({ kind: "idle" })

  if (!data) {
    if (error && !isLoading) {
      if (error instanceof ApiError && (error.code === "GOOGLE_RECONNECT_REQUIRED" || error.code === "GOOGLE_NOT_CONNECTED")) {
        const reconnect = error.code === "GOOGLE_RECONNECT_REQUIRED"
        return (
          <div className="flex flex-col gap-4">
            <Alert variant="warning" role="status">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertTitle>{reconnect ? GOOGLE_COPY.reconnect : GOOGLE_COPY.notConnected}</AlertTitle>
            </Alert>
            <Button asChild className="self-start">
              <a href={CONNECT_URL}>
                <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
                {reconnect ? "Reconnect Google Calendar" : "Connect Google Calendar"}
              </a>
            </Button>
          </div>
        )
      }
      return (
        <ErrorState
          title="Calendars didn't load."
          description="Your calendar choices are saved. Retry to see or change them."
          onRetry={() => void mutate()}
          retrying={isValidating}
        />
      )
    }
    return (
      <LoadingRegion label="Loading your calendars…" className="flex flex-col gap-6">
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-12 w-full max-w-sm rounded-md" />
        </div>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-5 w-56" />
          <Skeleton className="h-5 w-48" />
        </div>
      </LoadingRegion>
    )
  }

  const calendars = data.calendars
  const primary = calendars.find((c) => c.primary)
  const toId = (stored: string) => (stored === "primary" && primary ? primary.id : stored)
  const toStored = (id: string) => (primary && id === primary.id ? "primary" : id)
  const label = (c: GoogleCalendar) => (c.primary ? `${c.summary} (primary)` : c.summary)

  const writable = calendars.filter((c) => c.accessRole === "owner" || c.accessRole === "writer")
  const selectedId = toId(status.default_calendar_id)
  const busyIds = new Set(status.busy_calendar_ids.map(toId))
  const saving = save.kind === "saving"

  async function savePreferences(
    body: { default_calendar_id?: string; busy_calendar_ids?: string[] },
    optimistic: GoogleStatus,
    doneMessage: string,
    failedMessage: string
  ) {
    setSave({ kind: "saving" })
    // Show the choice at once; roll back if the server says no.
    await mutateStatus(optimistic, { revalidate: false })
    try {
      await apiPost("/api/integrations/google/preferences", body)
      setSave({ kind: "saved", message: doneMessage })
    } catch (err) {
      await mutateStatus(status, { revalidate: false })
      setSave({ kind: "failed", message: failureMessage(err, failedMessage) })
    }
  }

  function chooseCalendar(id: string) {
    const stored = toStored(id)
    if (stored === status.default_calendar_id) return
    void savePreferences(
      { default_calendar_id: stored },
      { ...status, default_calendar_id: stored, selected_calendar_id: stored },
      "Calendar saved",
      "Calendar not saved. Check your connection and retry."
    )
  }

  function toggleBusy(id: string, checked: boolean) {
    const next = new Set(busyIds)
    if (checked) next.add(id)
    else next.delete(id)
    if (next.size === 0) return
    const stored = [...next].map(toStored)
    void savePreferences(
      { busy_calendar_ids: stored },
      { ...status, busy_calendar_ids: stored },
      "Busy calendars saved",
      "Busy calendars not saved. Check your connection and retry."
    )
  }

  return (
    <SettingsRows>
      <Field>
        <FieldLabel htmlFor="settings-session-calendar">Calendar for sessions</FieldLabel>
        <FieldDescription id="settings-session-calendar-description">
          Sessions you add from the Plan page go to this calendar.
        </FieldDescription>
        {writable.length > 0 ? (
          <Select value={writable.some((c) => c.id === selectedId) ? selectedId : ""} onValueChange={chooseCalendar} disabled={saving}>
            <SelectTrigger
              id="settings-session-calendar"
              className="w-full @md:w-auto @md:min-w-72 @md:max-w-md"
              aria-describedby="settings-session-calendar-description"
            >
              <SelectValue placeholder="Choose a calendar" />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {writable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {label(c)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <p className="type-body-m text-on-surface-variant">
            None of your Google calendars accept new events from Study Bot. Create a calendar in
            Google Calendar, then reload this page.
          </p>
        )}
      </Field>

      <FieldSet>
        <FieldLegend variant="label">Busy times</FieldLegend>
        <FieldDescription>
          New plans skip the times these calendars show you as busy. Keep at least one checked.
        </FieldDescription>
        <div className="flex flex-col gap-3">
          {calendars.map((c) => {
            const checked = busyIds.has(c.id)
            const onlyOne = checked && busyIds.size === 1
            const id = `settings-busy-${c.id}`
            return (
              <Field key={c.id} orientation="horizontal" data-disabled={onlyOne || saving ? true : undefined}>
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={onlyOne || saving}
                  onCheckedChange={(value) => toggleBusy(c.id, value === true)}
                />
                <FieldLabel htmlFor={id} className="min-w-0 break-words type-body-l font-normal">
                  {label(c)}
                </FieldLabel>
              </Field>
            )
          })}
        </div>
        {/* One status line for both choices; it stays mounted so results are announced. */}
        <p role="status" className="empty:hidden flex items-center gap-1.5 type-body-m text-on-surface-variant">
          {save.kind === "saving" ? "Saving…" : null}
          {save.kind === "saved" ? (
            <>
              <CheckIcon className="size-4 text-tertiary" aria-hidden="true" />
              {save.message}
            </>
          ) : null}
        </p>
        {save.kind === "failed" ? <FieldError>{save.message}</FieldError> : null}
      </FieldSet>
    </SettingsRows>
  )
}
