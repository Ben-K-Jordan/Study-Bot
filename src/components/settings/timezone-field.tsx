"use client"

import { memo, useMemo } from "react"
import { CheckIcon, LocateFixedIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useMounted } from "@/hooks/use-mounted"
import { deviceTimeZone, isListedZone, zoneDisplayName, zoneGroups } from "./time-zones"
import { ZoneClock } from "./zone-clock"

const FIELD_ID = "settings-timezone"

/**
 * The time zone picker: every IANA zone grouped by region, a one-click
 * "Use this device's time zone", and the current time there. Memoized so
 * typing elsewhere in the form doesn't re-render the zone list.
 */
export const TimezoneField = memo(function TimezoneField({
  value,
  onChange,
  error,
  disabled,
}: {
  value: string | null
  onChange: (zone: string) => void
  error?: string
  disabled?: boolean
}) {
  const mounted = useMounted()
  const device = mounted ? deviceTimeZone() : null
  const groups = zoneGroups()

  // A saved zone the list doesn't offer (an alias such as US/Eastern) still shows.
  const unlisted = value && !isListedZone(value) ? value : null

  const items = useMemo(
    () =>
      groups.map((group) => (
        <SelectGroup key={group.region || "utc"}>
          {group.region ? <SelectLabel>{group.region}</SelectLabel> : null}
          {group.zones.map((zone) => (
            <SelectItem key={zone.id} value={zone.id}>
              {zone.label}
            </SelectItem>
          ))}
        </SelectGroup>
      )),
    [groups]
  )

  const descriptionId = `${FIELD_ID}-description`
  const clockId = `${FIELD_ID}-clock`
  const errorId = `${FIELD_ID}-error`

  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={FIELD_ID}>Time zone</FieldLabel>
      <FieldDescription id={descriptionId}>
        A new day starts at midnight in this time zone. Your streak, daily XP, and today&apos;s sessions count from then.
      </FieldDescription>
      <div className="flex flex-col gap-3 @lg:flex-row @lg:items-center">
        <Select value={value ?? ""} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            id={FIELD_ID}
            className="w-full @lg:w-auto @lg:min-w-72 @lg:max-w-sm"
            aria-invalid={error ? true : undefined}
            aria-describedby={[descriptionId, value ? clockId : null, error ? errorId : null]
              .filter(Boolean)
              .join(" ")}
          >
            <SelectValue placeholder="Choose a time zone">
              {value ? <span suppressHydrationWarning>{zoneDisplayName(value)}</span> : undefined}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            {unlisted ? (
              <SelectGroup>
                <SelectItem value={unlisted}>{unlisted}</SelectItem>
              </SelectGroup>
            ) : null}
            {items}
          </SelectContent>
        </Select>
        {device && device !== value ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => onChange(device)}
            disabled={disabled}
            className="self-start @lg:self-auto"
          >
            <LocateFixedIcon data-icon="inline-start" aria-hidden="true" />
            Use this device&apos;s time zone
          </Button>
        ) : device ? (
          <p className="flex items-center gap-1.5 type-body-m text-on-surface-variant">
            <CheckIcon className="size-4 text-tertiary" aria-hidden="true" />
            Matches this device
          </p>
        ) : null}
      </div>
      {value ? (
        <ZoneClock timeZone={value} id={clockId} />
      ) : (
        <p className="type-body-m text-on-surface-variant">Not set, so days follow UTC.</p>
      )}
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </Field>
  )
})
