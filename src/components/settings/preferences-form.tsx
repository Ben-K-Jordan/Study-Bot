"use client"

import { useCallback, useEffect, useId, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { CheckIcon, CircleAlertIcon } from "lucide-react"

import {
  SETTINGS_INVALID_MESSAGE,
  validateSettings,
  type SettingsField,
  type SettingsFieldErrors,
  type UserSettings,
} from "@/app/api/settings/rules"
import { ErrorState } from "@/components/app/error-state"
import { LoadingRegion } from "@/components/app/skeletons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Spinner } from "@/components/ui/spinner"
import { ApiError } from "@/lib/client-api"
import { formatDuration, formatNumber } from "@/lib/format"
import { useApi } from "@/lib/swr"
import { cn } from "@/lib/utils"
import { SIGNED_OUT_MESSAGE, failureMessage, sendJson } from "./request"
import { SettingsRows, SettingsSection } from "./settings-section"
import { storeStudyPrefs } from "./study-prefs-storage"
import { TimezoneField } from "./timezone-field"

export interface AccountSummary {
  name: string | null
  email: string
}

const NOT_SAVED = "Settings not saved. Check your connection and retry."

const CAP_STEPS = Array.from({ length: 16 }, (_, i) => 30 * (i + 1)) // 30 min to 8 hr
const XP_STEPS = [10, 20, 30, 40, 50, 75, 100, 150, 200, 300, 400, 500]

/** Field ids, in the order the page shows them (for focusing the first error). */
const FIELD_IDS: Record<SettingsField, string> = {
  timezone: "settings-timezone",
  studyStart: "settings-study-start",
  studyEnd: "settings-study-end",
  dailyCap: "settings-daily-cap",
  dailyXpGoal: "settings-xp-goal",
}
const FIELD_ORDER: SettingsField[] = ["timezone", "studyStart", "studyEnd", "dailyCap", "dailyXpGoal"]

function withValue(steps: number[], value: number): number[] {
  return steps.includes(value) ? steps : [...steps, value].toSorted((a, b) => a - b)
}

function sameSettings(a: UserSettings, b: UserSettings): boolean {
  return (
    a.studyStart === b.studyStart &&
    a.studyEnd === b.studyEnd &&
    a.dailyCap === b.dailyCap &&
    a.dailyXpGoal === b.dailyXpGoal &&
    a.timezone === b.timezone
  )
}

function pickSettings(data: UserSettings): UserSettings {
  return {
    studyStart: data.studyStart,
    studyEnd: data.studyEnd,
    dailyCap: data.dailyCap,
    dailyXpGoal: data.dailyXpGoal,
    timezone: data.timezone ?? null,
  }
}

function focusFirstInvalid(errors: SettingsFieldErrors) {
  const field = FIELD_ORDER.find((f) => errors[f])
  if (!field) return
  requestAnimationFrame(() => document.getElementById(FIELD_IDS[field])?.focus())
}

/**
 * Profile and Study preferences: one form with an explicit Save settings.
 * Loads from the server render when it can; otherwise fetches, with a
 * skeleton and a Retry on failure (never the defaults posing as saved).
 */
export function PreferencesForm({
  initial,
  account,
}: {
  initial: UserSettings | null
  account: AccountSummary | null
}) {
  const { data, error, isLoading, mutate } = useApi<UserSettings>(initial ? null : "/api/settings")
  const settings = initial ?? (data ? pickSettings(data) : null)

  if (settings) return <PreferencesEditor initial={settings} account={account} />

  return (
    <>
      <SettingsSection id="profile" title="Profile">
        <SettingsRows>
          <AccountDetails account={account} />
          {error && !isLoading ? (
            <ErrorState
              title="Settings didn't load."
              description="Your saved settings are safe. Retry to edit them."
              onRetry={() => void mutate()}
            />
          ) : (
            <FieldsSkeleton rows={1} />
          )}
        </SettingsRows>
      </SettingsSection>
      <SettingsSection id="study" title="Study preferences">
        {error && !isLoading ? (
          <p className="type-body-m text-on-surface-variant">
            Study preferences load with the rest of your settings. Use Retry under Profile.
          </p>
        ) : (
          <FieldsSkeleton rows={3} />
        )}
      </SettingsSection>
    </>
  )
}

function FieldsSkeleton({ rows }: { rows: number }) {
  return (
    <LoadingRegion label="Loading settings…" className="flex flex-col gap-6">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden="true" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-64 max-w-full" />
          <Skeleton className="h-12 w-full max-w-sm rounded-md" />
        </div>
      ))}
    </LoadingRegion>
  )
}

function AccountDetails({ account }: { account: AccountSummary | null }) {
  const router = useRouter()
  if (!account) {
    return (
      <ErrorState
        title="Account details didn't load."
        onRetry={() => router.refresh()}
      />
    )
  }
  return (
    <dl className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5 @md:grid @md:grid-cols-[8rem_minmax(0,1fr)] @md:items-baseline @md:gap-6">
        <dt className="type-label-l text-on-surface-variant">Name</dt>
        <dd className="type-body-l break-words text-on-surface">{account.name || "Not set"}</dd>
      </div>
      <div className="flex flex-col gap-0.5 @md:grid @md:grid-cols-[8rem_minmax(0,1fr)] @md:items-baseline @md:gap-6">
        <dt className="type-label-l text-on-surface-variant">Email</dt>
        <dd className="type-body-l break-all text-on-surface">{account.email}</dd>
      </div>
    </dl>
  )
}

type SaveStatus = "idle" | "saving" | "saved" | "failed"

function PreferencesEditor({
  initial,
  account,
}: {
  initial: UserSettings
  account: AccountSummary | null
}) {
  const [saved, setSaved] = useState(initial)
  const [values, setValues] = useState(initial)
  const [status, setStatus] = useState<SaveStatus>("idle")
  const [failure, setFailure] = useState<{ message: string; signedOut: boolean } | null>(null)
  const [attempted, setAttempted] = useState(false)
  const [serverErrors, setServerErrors] = useState<SettingsFieldErrors>({})
  const statusId = useId()

  const dirty = !sameSettings(values, saved)
  // Client checks run live once a save was attempted, so fixes clear errors as you type.
  const errors: SettingsFieldErrors = { ...serverErrors, ...(attempted ? validateSettings(values) : {}) }

  // Keep the plan page's fallback in step with what the server has.
  useEffect(() => {
    storeStudyPrefs(initial)
  }, [initial])

  // Warn before a reload or tab close throws away unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener("beforeunload", onBeforeUnload)
    return () => window.removeEventListener("beforeunload", onBeforeUnload)
  }, [dirty])

  const update = useCallback(<K extends SettingsField>(field: K, value: UserSettings[K]) => {
    setValues((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => {
      if (!current[field]) return current
      const next = { ...current }
      delete next[field]
      return next
    })
  }, [])

  const onTimezoneChange = useCallback((zone: string) => update("timezone", zone), [update])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === "saving") return

    const clientErrors = validateSettings(values)
    if (Object.keys(clientErrors).length > 0) {
      setAttempted(true)
      setStatus("failed")
      setFailure({ message: SETTINGS_INVALID_MESSAGE, signedOut: false })
      focusFirstInvalid(clientErrors)
      return
    }

    const submitted = values
    setStatus("saving")
    setFailure(null)
    try {
      const result = pickSettings(await sendJson<UserSettings>("PUT", "/api/settings", submitted))
      setSaved(result)
      setValues((current) => (sameSettings(current, submitted) ? result : current))
      setAttempted(false)
      setServerErrors({})
      setStatus("saved")
      storeStudyPrefs(result)
    } catch (err) {
      const fields = err instanceof ApiError ? (err.body as { fields?: SettingsFieldErrors } | null)?.fields : undefined
      if (err instanceof ApiError && err.status === 400 && fields && Object.keys(fields).length > 0) {
        setServerErrors(fields)
        setFailure({ message: SETTINGS_INVALID_MESSAGE, signedOut: false })
        focusFirstInvalid(fields)
      } else {
        const message = failureMessage(err, NOT_SAVED)
        setFailure({ message, signedOut: message === SIGNED_OUT_MESSAGE })
      }
      setStatus("failed")
    }
  }

  function discard() {
    setValues(saved)
    setAttempted(false)
    setServerErrors({})
    setFailure(null)
    setStatus("idle")
  }

  const saving = status === "saving"
  const statusText = saving
    ? "Saving…"
    : dirty
      ? "Unsaved changes"
      : status === "saved"
        ? "Settings saved"
        : ""

  const capOptions = withValue(CAP_STEPS, values.dailyCap)
  const xpOptions = withValue(XP_STEPS, values.dailyXpGoal)

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      className="flex flex-col gap-6 sm:[&_:focus]:scroll-mb-28"
    >
      <SettingsSection id="profile" title="Profile">
        <SettingsRows>
          <AccountDetails account={account} />
          <TimezoneField
            value={values.timezone}
            onChange={onTimezoneChange}
            error={errors.timezone}
            disabled={saving}
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection id="study" title="Study preferences">
        <SettingsRows>
          <FieldSet>
            <FieldLegend variant="label">Study hours</FieldLegend>
            <FieldDescription>
              New plans schedule sessions between these times each day. Plans you already made keep
              their own hours.
            </FieldDescription>
            <div className="grid gap-4 @md:max-w-lg @md:grid-cols-2">
              <TimeField
                id={FIELD_IDS.studyStart}
                label="Daily start time"
                value={values.studyStart}
                onChange={(v) => update("studyStart", v)}
                error={errors.studyStart}
                disabled={saving}
              />
              <TimeField
                id={FIELD_IDS.studyEnd}
                label="Daily end time"
                value={values.studyEnd}
                onChange={(v) => update("studyEnd", v)}
                error={errors.studyEnd}
                disabled={saving}
              />
            </div>
          </FieldSet>

          <NumberSelectField
            id={FIELD_IDS.dailyCap}
            label="Daily study limit"
            description="New plans schedule at most this much study time on any one day."
            value={values.dailyCap}
            options={capOptions}
            format={formatDuration}
            onChange={(v) => update("dailyCap", v)}
            error={errors.dailyCap}
            disabled={saving}
          />

          <NumberSelectField
            id={FIELD_IDS.dailyXpGoal}
            label="Daily XP goal"
            description="Home shows how much of this goal you've reached today."
            value={values.dailyXpGoal}
            options={xpOptions}
            format={(n) => `${formatNumber(n)} XP`}
            onChange={(v) => update("dailyXpGoal", v)}
            error={errors.dailyXpGoal}
            disabled={saving}
          />
        </SettingsRows>
      </SettingsSection>

      {failure ? (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden="true" />
          <AlertTitle>{failure.message}</AlertTitle>
          {failure.signedOut ? (
            <AlertDescription>
              <Link href="/auth/signin?callbackUrl=%2Fsettings">Sign in again</Link>
            </AlertDescription>
          ) : null}
        </Alert>
      ) : null}

      <div
        data-dirty={dirty || undefined}
        className={cn(
          "-mt-2 flex flex-wrap items-center justify-end gap-x-3 gap-y-2 rounded-2xl px-4 py-3 transition-[background-color,box-shadow] duration-150 ease-standard",
          // With unsaved changes the bar turns tonal and, from 600px up, stays in view while you scroll.
          "data-dirty:bg-surface-container sm:data-dirty:sticky sm:data-dirty:bottom-4 sm:data-dirty:z-10 sm:data-dirty:shadow-md"
        )}
      >
        <p
          id={statusId}
          role="status"
          className="mr-auto flex min-h-6 items-center gap-1.5 type-body-m text-on-surface-variant"
        >
          {status === "saved" && !dirty && !saving ? (
            <CheckIcon className="size-4 text-tertiary" aria-hidden="true" />
          ) : null}
          {statusText}
        </p>
        {dirty && !saving ? (
          <Button type="button" variant="text" onClick={discard}>
            Discard changes
          </Button>
        ) : null}
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} /> : null}
          {saving ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  )
}

function TimeField({
  id,
  label,
  value,
  onChange,
  error,
  disabled,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  disabled?: boolean
}) {
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="time"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        className="tabular-nums"
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
}

function NumberSelectField({
  id,
  label,
  description,
  value,
  options,
  format,
  onChange,
  error,
  disabled,
}: {
  id: string
  label: string
  description: string
  value: number
  options: number[]
  format: (value: number) => string
  onChange: (value: number) => void
  error?: string
  disabled?: boolean
}) {
  const descriptionId = `${id}-description`
  const errorId = `${id}-error`
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <FieldDescription id={descriptionId}>{description}</FieldDescription>
      <Select value={String(value)} onValueChange={(v) => onChange(Number(v))} disabled={disabled}>
        <SelectTrigger
          id={id}
          className="w-full @md:w-56"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${descriptionId} ${errorId}` : descriptionId}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent position="popper" className="max-h-80">
          <SelectGroup>
            {options.map((option) => (
              <SelectItem key={option} value={String(option)}>
                {format(option)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
}
