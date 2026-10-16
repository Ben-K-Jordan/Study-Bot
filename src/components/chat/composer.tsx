"use client"

import * as React from "react"
import { SendHorizontalIcon } from "lucide-react"

import { formatNumber } from "@/lib/format"
import { KbdHint } from "@/components/app/kbd-hint"
import { Button } from "@/components/ui/button"
import { FieldError } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupTextarea } from "@/components/ui/input-group"
import { Spinner } from "@/components/ui/spinner"
import { QUESTION_MAX } from "@/components/chat/chat-types"

export interface ComposerHandle {
  focus: () => void
  /** Puts text in the box (a suggested question) and focuses it. */
  fill: (text: string) => void
}

/**
 * The question box: a textarea that grows with the text. Enter asks,
 * Shift+Enter starts a new line, and nothing is sent mid-composition (IME).
 * The box stays editable while an answer is on its way, and focus stays in
 * it after asking. The page renders the visible label (`htmlFor={id}`), so
 * it can sit in the sticky bar or just above it.
 */
export const Composer = React.forwardRef<
  ComposerHandle,
  {
    /** The textarea's id, for the page's label. */
    id: string
    /** An answer is on its way: asking again waits for it. */
    busy: boolean
    disabled?: boolean
    onAsk: (question: string) => void
  }
>(function Composer({ id, busy, disabled = false, onAsk }, ref) {
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const [value, setValue] = React.useState("")

  React.useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    fill: (text: string) => {
      setValue(text)
      textareaRef.current?.focus()
    },
  }))

  const trimmed = value.trim()
  const length = value.length
  const tooLong = length > QUESTION_MAX
  const nearLimit = length > QUESTION_MAX - 200
  const canAsk = !disabled && !busy && trimmed.length > 0 && !tooLong

  function ask() {
    if (!canAsk) return
    onAsk(trimmed)
    setValue("")
    textareaRef.current?.focus()
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault()
        ask()
      }}
    >
      <InputGroup className="bg-surface-container-lowest">
        <InputGroupTextarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey) return
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            event.preventDefault()
            ask()
          }}
          rows={1}
          disabled={disabled}
          aria-invalid={tooLong || undefined}
          aria-describedby={`${id}-hint${tooLong ? ` ${id}-error` : ""}`}
          className="max-h-60 min-h-14 overflow-y-auto px-4 pt-3.5"
        />
        <InputGroupAddon align="block-end" className="justify-between gap-3 px-2 pb-2">
          <span id={`${id}-hint`} className="flex min-w-0 items-center gap-1.5 pl-2 type-body-s text-on-surface-variant">
            {nearLimit ? (
              <span className="tabular-nums">
                {formatNumber(length)} of {formatNumber(QUESTION_MAX)} characters
              </span>
            ) : (
              <>
                <span className="sr-only">Enter asks the question. Shift+Enter starts a new line.</span>
                <span aria-hidden="true" className="hidden items-center gap-1.5 sm:flex pointer-coarse:hidden">
                  <KbdHint keys="Enter" />
                  to ask,
                  <KbdHint keys={["Shift", "Enter"]} />
                  for a new line
                </span>
              </>
            )}
          </span>
          <Button type="submit" disabled={!canAsk}>
            {busy ? (
              <Spinner data-icon="inline-start" aria-hidden="true" role={undefined} />
            ) : (
              <SendHorizontalIcon data-icon="inline-start" aria-hidden="true" />
            )}
            Ask
          </Button>
        </InputGroupAddon>
      </InputGroup>
      {tooLong ? (
        <FieldError id={`${id}-error`}>Shorten your question to {formatNumber(QUESTION_MAX)} characters.</FieldError>
      ) : null}
    </form>
  )
})
