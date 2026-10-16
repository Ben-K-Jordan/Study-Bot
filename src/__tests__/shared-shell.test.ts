import { describe, expect, it } from "vitest"

import { buildCourseOptions } from "@/hooks/use-course-options"
import { firstConnected, resolveOpener, type FocusTarget } from "@/components/app/return-focus"
import { lessonProgressText } from "@/components/lesson/lesson-frame"
import { NAV_ITEMS, ROUTE_TITLES, goToLabel, titleFor } from "@/components/shell/nav-items"
import { sessionFabLabel, showsFloatingFab } from "@/components/shell/session-fab"

describe("titleFor (the app bar h1)", () => {
  it("uses the destination title", () => {
    expect(titleFor("/")).toBe("Home")
    expect(titleFor("/plan")).toBe("Plan")
    expect(titleFor("/flashcards/abc")).toBe("Flashcards")
    expect(titleFor("/guides")).toBe("Study guides")
  })

  it("uses the more specific route title, so the server HTML already has it", () => {
    expect(titleFor("/plan/new")).toBe("New plan")
    expect(titleFor("/plan/materials")).toBe("Materials")
    expect(titleFor("/plan/materials/")).toBe("Materials")
    expect(titleFor("/design")).toBe("Design system")
    expect(Object.keys(ROUTE_TITLES)).toContain("/plan/new")
  })

  it("falls back to the app name outside the destinations", () => {
    expect(titleFor("/somewhere")).toBe("Study Bot")
  })
})

describe("goToLabel", () => {
  it("names the destination by its page title", () => {
    const byHref = (href: string) => NAV_ITEMS.find((item) => item.href === href)!
    expect(goToLabel(byHref("/"))).toBe("Go to Home")
    expect(goToLabel(byHref("/plan"))).toBe("Go to Plan")
    expect(goToLabel(byHref("/flashcards"))).toBe("Go to Flashcards")
  })
})

describe("sessionFabLabel", () => {
  it("starts today's session or resumes one under way", () => {
    expect(sessionFabLabel(false)).toBe("Start today's session")
    expect(sessionFabLabel(true)).toBe("Resume session")
  })
})

describe("showsFloatingFab", () => {
  it("stays off Home, Chat and Settings on phones, where it would cover their own controls", () => {
    expect(showsFloatingFab("/")).toBe(false)
    expect(showsFloatingFab("/chat")).toBe(false)
    expect(showsFloatingFab("/settings")).toBe(false)
    expect(showsFloatingFab("/settings-other")).toBe(true)
    expect(showsFloatingFab("/plan")).toBe(true)
    expect(showsFloatingFab("/flashcards/abc")).toBe(true)
  })
})

describe("lessonProgressText", () => {
  it("uses the singular for one question", () => {
    expect(lessonProgressText(0, 1)).toBe("0 of 1 question done")
    expect(lessonProgressText(1, 1)).toBe("1 of 1 question done")
  })

  it("uses the plural otherwise", () => {
    expect(lessonProgressText(3, 12)).toBe("3 of 12 questions done")
    expect(lessonProgressText(0, 0)).toBe("0 of 0 questions done")
  })
})

describe("buildCourseOptions", () => {
  it("lists courses with a ready file first, then by the latest upload", () => {
    const options = buildCourseOptions([
      { course_name: "ECON 1110", exam_name: "Prelim 1", status: "PENDING", created_at: "2026-10-14T10:00:00Z" },
      { course_name: "CS 2110", exam_name: "Prelim 1", status: "PROCESSED", created_at: "2026-10-01T10:00:00Z" },
      { course_name: "INFO 1300", exam_name: null, status: "PROCESSED", created_at: "2026-10-10T10:00:00Z" },
      { course_name: "CS 2110", exam_name: "Prelim 1", status: "FAILED", created_at: "2026-10-02T10:00:00Z" },
    ])
    expect(options.map((o) => o.key)).toEqual(["INFO 1300", "CS 2110||Prelim 1", "ECON 1110||Prelim 1"])
    expect(options[1]).toEqual({
      key: "CS 2110||Prelim 1",
      course_name: "CS 2110",
      exam_name: "Prelim 1",
      doc_count: 2,
      ready_count: 1,
    })
    expect(options[2].ready_count).toBe(0)
  })

  it("skips files with no course and orders ties by name", () => {
    const options = buildCourseOptions([
      { course_name: null, exam_name: null },
      { course_name: "B course", exam_name: null },
      { course_name: "A course", exam_name: null },
    ])
    expect(options.map((o) => o.key)).toEqual(["A course", "B course"])
  })
})

function fakeElement(
  connected: boolean,
  menuLabelledBy?: string
): FocusTarget & { focused: boolean } {
  return {
    isConnected: connected,
    focused: false,
    focus() {
      this.focused = true
    },
    closest: (selector) =>
      selector === "[role='menu']" && menuLabelledBy
        ? { getAttribute: (name) => (name === "aria-labelledby" ? menuLabelledBy : null) }
        : null,
  }
}

describe("return focus after a dialog", () => {
  it("returns to the element that had focus", () => {
    const button = fakeElement(true)
    expect(resolveOpener(button, {}, () => null)).toBe(button)
  })

  it("returns to a menu's trigger when the dialog was opened from a menu item", () => {
    const trigger = fakeElement(true)
    const item = fakeElement(true, "radix-trigger-1")
    expect(resolveOpener(item, {}, (id) => (id === "radix-trigger-1" ? trigger : null))).toBe(trigger)
  })

  it("keeps the item when the menu's trigger can't be found", () => {
    const item = fakeElement(true, "missing")
    expect(resolveOpener(item, {}, () => null)).toBe(item)
  })

  it("has no opener when focus was on <body>", () => {
    const body = fakeElement(true)
    expect(resolveOpener(body, body, () => null)).toBeNull()
    expect(resolveOpener(null, body, () => null)).toBeNull()
  })

  it("skips an opener that left the page (a deleted row) for the fallback", () => {
    const gone = fakeElement(false)
    const heading = fakeElement(true)
    const main = fakeElement(true)
    expect(firstConnected([gone, heading, main])).toBe(heading)
    expect(firstConnected([gone, null, main])).toBe(main)
    expect(firstConnected([gone, undefined])).toBeNull()
  })
})
