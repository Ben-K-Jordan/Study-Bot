"use client"

import * as React from "react"

import { AnswerOption, AnswerOptionGroup } from "@/components/lesson/answer-option"
import { ConfidencePicker, type ConfidenceValue } from "@/components/lesson/confidence-picker"
import { FeedbackSheet } from "@/components/lesson/feedback-sheet"
import { FreeRecallInput } from "@/components/lesson/free-recall-input"
import { LessonButton } from "@/components/lesson/lesson-button"
import { LessonFrame, LessonProgress } from "@/components/lesson/lesson-frame"

import { ShowcaseSection, StateMatrix, previewState } from "./helpers"

const BUTTON_VARIANTS = ["check", "correct", "wrong", "neutral", "primary"] as const
const BUTTON_LABELS: Record<(typeof BUTTON_VARIANTS)[number], string> = {
  check: "Check",
  correct: "Continue",
  wrong: "Continue",
  neutral: "Skip",
  primary: "Start session",
}

const OPTION_STATES = ["idle", "hover", "focus", "selected", "pending", "correct", "wrong", "disabled"] as const

const CHOICES = [
  "The function's local variables, parameters and return address",
  "Every object the program has allocated so far",
  "The compiled bytecode of the method",
  "Only the value the function returns",
]

function LessonBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="type-title-m text-on-surface">{title}</h3>
      <div className="lesson rounded-2xl p-5 ring-1 ring-border">{children}</div>
    </div>
  )
}

/** A working one-question lesson: pick, check, read feedback, continue. */
function LiveLesson() {
  const [selected, setSelected] = React.useState<string | null>(null)
  const [confidence, setConfidence] = React.useState<ConfidenceValue | null>(null)
  const [checked, setChecked] = React.useState(false)
  const [done, setDone] = React.useState(0)
  const correct = "0"
  const isCorrect = selected === correct

  function reset() {
    setSelected(null)
    setConfidence(null)
    setChecked(false)
    setDone((d) => (d + 1) % 5)
  }

  return (
    <div className="lesson h-[46rem] overflow-hidden rounded-2xl ring-1 ring-border">
      <LessonFrame
        className="min-h-0 h-full overflow-y-auto"
        current={done}
        total={5}
        status="Retrieval"
        onClose={reset}
        question="What does a stack frame hold?"
        questionId="ds-live-question"
        headingLevel="h2"
        footer={
          <>
            <LessonButton variant="neutral" onClick={reset} kbd="Esc">
              Skip
            </LessonButton>
            <LessonButton
              variant="check"
              disabled={selected === null}
              onClick={() => setChecked(true)}
              kbd="Enter"
              className="sm:min-w-40"
            >
              Check
            </LessonButton>
          </>
        }
        feedback={
          checked ? (
            <FeedbackSheet
              tone={isCorrect ? "correct" : "wrong"}
              title={isCorrect ? "Correct" : "Incorrect"}
              onContinue={reset}
            >
              <p>
                {isCorrect
                  ? "Each call gets its own frame with its locals, parameters and return address."
                  : "A frame holds one call's locals, parameters and return address. Objects live on the heap."}
              </p>
              <p className="type-body-m opacity-90">Source 2: Lecture 5, page 3</p>
            </FeedbackSheet>
          ) : null
        }
      >
        <AnswerOptionGroup labelledBy="ds-live-question">
          {CHOICES.map((choice, i) => (
            <AnswerOption
              key={choice}
              name="ds-live"
              value={String(i)}
              hint={String(i + 1)}
              checked={selected === String(i)}
              onSelect={setSelected}
              disabled={checked}
              result={checked ? (String(i) === correct ? "correct" : selected === String(i) ? "wrong" : undefined) : undefined}
            >
              {choice}
            </AnswerOption>
          ))}
        </AnswerOptionGroup>
        <ConfidencePicker value={confidence} onChange={setConfidence} hints={["Q", "W", "E"]} disabled={checked} />
      </LessonFrame>
    </div>
  )
}

export function LessonPrimitives() {
  const [recall, setRecall] = React.useState("")
  return (
    <ShowcaseSection
      id="lesson"
      title="Lesson primitives"
      description="src/components/lesson, inside the .lesson scope: rounded type, heavier weights, Google's green, red and blue in Duolingo's grammar. Number keys belong to the screen; primitives only draw the hints."
    >
      <LessonBlock title="LessonButton">
        <StateMatrix
          rows={BUTTON_VARIANTS}
          states={["default", "hover", "focus", "active", "disabled", "loading"]}
          render={(variant, state) =>
            state === "loading" ? (
              <LessonButton variant={variant} loading loadingLabel="Checking…">
                {BUTTON_LABELS[variant]}
              </LessonButton>
            ) : (
              <LessonButton variant={variant} {...previewState(state)}>
                {BUTTON_LABELS[variant]}
              </LessonButton>
            )
          }
        />
      </LessonBlock>

      <LessonBlock title="AnswerOption">
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {OPTION_STATES.map((state) => (
            <div key={state} className="flex flex-col gap-1.5">
              <span className="font-mono text-xs text-lesson-muted">{state}</span>
              <AnswerOption
                name={`ds-option-${state}`}
                value="a"
                hint="2"
                checked={state === "selected" || state === "pending" || state === "focus"}
                onSelect={() => undefined}
                pending={state === "pending"}
                result={state === "correct" ? "correct" : state === "wrong" ? "wrong" : undefined}
                disabled={state === "disabled"}
                {...(state === "hover" || state === "focus" ? { "data-preview": state } : {})}
              >
                {state === "idle"
                  ? "A stack frame holds the function's local variables, parameters and the return address, which can run onto a second line."
                  : CHOICES[0]}
              </AnswerOption>
            </div>
          ))}
        </div>
      </LessonBlock>

      <div className="grid gap-6 lg:grid-cols-2">
        <LessonBlock title="ConfidencePicker">
          <div className="flex flex-col gap-6">
            <ConfidencePicker value={null} onChange={() => undefined} hints={["Q", "W", "E"]} />
            <ConfidencePicker value={5} onChange={() => undefined} description="Selected: Sure." />
            <ConfidencePicker value={3} onChange={() => undefined} disabled description="Disabled after checking." />
          </div>
        </LessonBlock>
        <LessonBlock title="FreeRecallInput">
          <div className="flex flex-col gap-6">
            <FreeRecallInput value={recall} onChange={(e) => setRecall(e.target.value)} />
            <FreeRecallInput
              label="Correction rule"
              description="The rule or fact that makes the answer right, in your own words."
              defaultValue="A base case returns without calling itself"
              error="Write the correction rule first."
              showSubmitHint={false}
            />
            <FreeRecallInput label="Your answer (disabled)" defaultValue="Locals and the return address" disabled />
          </div>
        </LessonBlock>
      </div>

      <LessonBlock title="LessonProgress">
        <div className="flex flex-col gap-4">
          {[0, 3, 9, 12].map((n) => (
            <div key={n} className="flex items-center gap-4">
              <span className="w-16 shrink-0 font-mono text-xs text-lesson-muted tabular-nums">
                {n} of 12
              </span>
              <LessonProgress current={n} total={12} />
            </div>
          ))}
        </div>
      </LessonBlock>

      <div className="flex flex-col gap-3">
        <h3 className="type-title-m text-on-surface">FeedbackSheet</h3>
        <div className="lesson flex flex-col overflow-hidden rounded-2xl ring-1 ring-border">
          <FeedbackSheet tone="correct" title="Correct" onContinue={() => undefined} autoFocusContinue={false}>
            <p>Each call gets its own frame with its locals, parameters and return address.</p>
          </FeedbackSheet>
          <FeedbackSheet
            tone="wrong"
            title="Incorrect"
            onContinue={() => undefined}
            autoFocusContinue={false}
            secondaryAction={<LessonButton variant="neutral">Log the error</LessonButton>}
          >
            <p>Correct answer: the function&apos;s local variables, parameters and return address.</p>
          </FeedbackSheet>
          <FeedbackSheet
            tone="neutral"
            title="Model answer shown. Score your answer against it."
            continueLabel="Next question"
            onContinue={() => undefined}
            autoFocusContinue={false}
            continueLoading
          >
            <p>Points to check: base case, smaller input each call.</p>
          </FeedbackSheet>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="type-title-m text-on-surface">LessonFrame, working example</h3>
        <p className="max-w-prose type-body-m text-on-surface-variant">
          Pick an answer and press Check. The footer turns into the feedback sheet; Continue moves on.
        </p>
        <LiveLesson />
      </div>
    </ShowcaseSection>
  )
}
