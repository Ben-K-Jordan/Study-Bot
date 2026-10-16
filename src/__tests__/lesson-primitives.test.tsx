import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { AnswerOption } from "@/components/lesson/answer-option"
import { ConfidencePicker } from "@/components/lesson/confidence-picker"
import { FeedbackSheet } from "@/components/lesson/feedback-sheet"
import { LessonButton } from "@/components/lesson/lesson-button"

/** Server markup: the node test environment has no DOM, so tests read attributes from it. */
function markup(element: React.ReactElement): string {
  return renderToStaticMarkup(element)
}

/** The opening tag of the first element whose attributes include `marker`. */
function tagWith(html: string, marker: string): string {
  const at = html.indexOf(marker)
  expect(at, `no element with ${marker}`).toBeGreaterThan(-1)
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1)
}

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? null
}

describe("FeedbackSheet", () => {
  it("describes Continue with the note, so the correction is read on the way", () => {
    const html = markup(
      <FeedbackSheet tone="wrong" title="Incorrect" continueLabel="Next question" onContinue={() => {}}>
        <p>Correct answer: A binary heap</p>
      </FeedbackSheet>
    )
    const button = tagWith(html, 'data-slot="lesson-button"')
    const describedBy = attribute(button, "aria-describedby")
    expect(describedBy).toBeTruthy()
    const note = tagWith(html, `id="${describedBy}"`)
    const noteText = html.slice(html.indexOf(note) + note.length, html.indexOf("</div>", html.indexOf(note)))
    expect(noteText).toContain("Correct answer: A binary heap")
  })

  it("has no description without a note", () => {
    const html = markup(<FeedbackSheet tone="correct" title="Correct" onContinue={() => {}} />)
    expect(attribute(tagWith(html, 'data-slot="lesson-button"'), "aria-describedby")).toBeNull()
  })

  it("draws the secondary action before Continue in the DOM and on screen", () => {
    const html = markup(
      <FeedbackSheet
        tone="wrong"
        title="Incorrect"
        onContinue={() => {}}
        secondaryAction={<LessonButton variant="neutral">Log the error</LessonButton>}
      />
    )
    expect(html.indexOf("Log the error")).toBeLessThan(html.indexOf("Continue"))
    // flex-col-reverse would put Continue on top while Tab reaches it second
    expect(html).not.toContain("flex-col-reverse")
  })
})

describe("selected state beyond colour", () => {
  const option = ({ checked, hint }: { checked: boolean; hint?: string }) =>
    markup(
      <AnswerOption name="q" value="0" checked={checked} hint={hint} onSelect={() => {}}>
        A binary heap
      </AnswerOption>
    )

  it("gives every answer option a marker that fills when selected", () => {
    for (const hint of ["1", undefined]) {
      const selected = option({ checked: true, hint })
      expect(attribute(tagWith(selected, 'data-slot="answer-option"'), "data-state")).toBe("selected")
      // A radio dot on touch screens (and when hints are off) …
      expect(selected).toContain('data-slot="answer-option-radio"')
      expect(selected).toContain("group-data-[state=selected]/option:scale-100")
    }
    // … and the key hint chip, inverted when selected, on fine pointers
    const hinted = tagWith(option({ checked: true, hint: "1" }), 'data-slot="answer-option-hint"')
    expect(hinted).toContain("group-data-[state=selected]/option:bg-lesson-on-selected")
  })

  it("marks the chosen confidence with a check, and only that one", () => {
    const html = markup(<ConfidencePicker value={5} onChange={() => {}} hints={["Q", "W", "E"]} />)
    expect(html.match(/data-check=""/g)).toHaveLength(1)
    const sure = html.slice(html.lastIndexOf('data-state="selected"'))
    expect(sure.indexOf("data-check")).toBeLessThan(sure.indexOf("Sure"))
    expect(markup(<ConfidencePicker value={null} onChange={() => {}} />)).not.toContain("data-check")
  })
})
