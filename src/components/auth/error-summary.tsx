"use client"

import { useId } from "react"
import { CircleAlertIcon } from "lucide-react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { focusOnMount } from "@/components/auth/auth-card"
import { plural } from "@/lib/format"

export interface SummaryItem {
  /** Id of the input the message belongs to. */
  fieldId: string
  message: string
}

function focusField(event: React.MouseEvent<HTMLAnchorElement>, fieldId: string) {
  const field = document.getElementById(fieldId)
  if (!field) return
  event.preventDefault()
  field.focus()
}

/**
 * The error summary at the top of an auth form. It takes focus when it
 * appears (give it a `key` that changes on each failed submit, and whenever
 * its message changes), lists each field error as a link to its field, or
 * carries one message from the server with an optional action.
 *
 * A summary that takes focus is a named group, not an alert: moving focus
 * already reads it, and an alert would be read a second time. One opened
 * with the page (focus off) stays an alert.
 */
export function ErrorSummary({
  items,
  message,
  focus = true,
  children,
}: {
  items?: SummaryItem[]
  message?: string
  /** Take focus on mount. Off for an error the page was opened with. */
  focus?: boolean
  /** An action under the message, such as "Send a new link". */
  children?: React.ReactNode
}) {
  const fieldItems = items ?? []
  const id = useId()
  const titleId = `${id}-title`
  const messageId = `${id}-message`
  const labelId = fieldItems.length > 0 ? titleId : message ? messageId : undefined
  return (
    <Alert
      variant="destructive"
      ref={focus ? focusOnMount : undefined}
      tabIndex={-1}
      role={focus ? "group" : "alert"}
      aria-labelledby={focus ? labelId : undefined}
    >
      <CircleAlertIcon aria-hidden="true" />
      {fieldItems.length > 0 ? (
        <>
          <AlertTitle id={titleId}>
            {plural(fieldItems.length, {
              one: "Fix 1 field to continue",
              other: "Fix # fields to continue",
            })}
          </AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {fieldItems.map((item) => (
                <li key={item.fieldId}>
                  <a href={`#${item.fieldId}`} onClick={(event) => focusField(event, item.fieldId)}>
                    {item.message}
                  </a>
                </li>
              ))}
            </ul>
          </AlertDescription>
        </>
      ) : (
        <AlertDescription>
          {message ? <p id={messageId}>{message}</p> : null}
          {children}
        </AlertDescription>
      )}
    </Alert>
  )
}
