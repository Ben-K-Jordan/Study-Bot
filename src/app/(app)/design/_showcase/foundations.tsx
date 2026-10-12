"use client"

import {
  BookOpenTextIcon,
  CalendarDaysIcon,
  ChartColumnIcon,
  CheckIcon,
  CircleAlertIcon,
  GraduationCapIcon,
  HouseIcon,
  LayersIcon,
  MessagesSquareIcon,
  SettingsIcon,
} from "lucide-react"

import { Block, ColorPair, ShowcaseSection } from "./helpers"

const SHELL_PAIRS: { name: string; bg: string; fg: string; min?: number }[] = [
  { name: "Page", bg: "background", fg: "foreground" },
  { name: "Card", bg: "card", fg: "card-foreground" },
  { name: "Menu and popover", bg: "popover", fg: "popover-foreground" },
  { name: "Filled button", bg: "primary", fg: "primary-foreground" },
  { name: "Tonal button, active nav", bg: "secondary", fg: "secondary-foreground" },
  { name: "Muted surface", bg: "muted", fg: "muted-foreground" },
  { name: "Hover and selected", bg: "accent", fg: "accent-foreground" },
  { name: "Primary container", bg: "primary-container", fg: "on-primary-container" },
  { name: "Success container", bg: "tertiary-container", fg: "on-tertiary-container" },
  { name: "Warning container", bg: "warning-container", fg: "on-warning-container" },
  { name: "Error container", bg: "error-container", fg: "on-error-container" },
  { name: "Snackbar and tooltip", bg: "inverse-surface", fg: "inverse-on-surface" },
  { name: "Secondary text on page", bg: "surface", fg: "on-surface-variant" },
  { name: "Secondary text, highest", bg: "surface-container-highest", fg: "on-surface-variant" },
  { name: "Link on page", bg: "surface", fg: "primary" },
  { name: "Success text", bg: "surface", fg: "tertiary" },
  { name: "Warning text", bg: "surface", fg: "warning" },
  { name: "Error text", bg: "surface", fg: "error" },
  { name: "Field border (UI, 3:1)", bg: "surface-container-lowest", fg: "outline", min: 3 },
  { name: "Focus ring (UI, 3:1)", bg: "surface", fg: "ring", min: 3 },
]

const LESSON_PAIRS: { name: string; bg: string; fg: string; min?: number }[] = [
  { name: "Lesson page", bg: "lesson-surface", fg: "lesson-on-surface" },
  { name: "Counter and hints", bg: "lesson-surface", fg: "lesson-muted" },
  { name: "Selected option", bg: "lesson-selected", fg: "lesson-on-selected" },
  { name: "Check button", bg: "lesson-check", fg: "lesson-on-check" },
  { name: "Start button", bg: "lesson-primary", fg: "lesson-on-primary" },
  { name: "Correct feedback", bg: "lesson-correct", fg: "lesson-on-correct" },
  { name: "Wrong feedback", bg: "lesson-wrong", fg: "lesson-on-wrong" },
  { name: "Wrong continue", bg: "lesson-wrong-button", fg: "lesson-on-wrong-button" },
  { name: "Progress fill (UI, 3:1)", bg: "lesson-progress-track", fg: "lesson-progress-fill", min: 3 },
]

const SURFACES = [
  "surface",
  "surface-container-lowest",
  "surface-container-low",
  "surface-container",
  "surface-container-high",
  "surface-container-highest",
]

const SWATCHES: { group: string; tokens: string[] }[] = [
  { group: "Surfaces", tokens: SURFACES },
  {
    group: "Lines and focus",
    tokens: ["outline", "outline-variant", "ring", "scrim"],
  },
  {
    group: "Accents",
    tokens: ["primary", "primary-container", "secondary-container", "tertiary", "tertiary-container", "warning", "warning-container", "error", "error-container", "inverse-primary"],
  },
  { group: "Charts", tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"] },
  {
    group: "Lesson",
    tokens: [
      "lesson-option-border",
      "lesson-option-hover",
      "lesson-selected",
      "lesson-selected-border",
      "lesson-check",
      "lesson-check-lip",
      "lesson-correct",
      "lesson-wrong",
      "lesson-wrong-button",
      "lesson-primary",
      "lesson-disabled",
      "lesson-progress-track",
      "lesson-progress-fill",
    ],
  },
]

const TYPE_SCALE: { token: string; spec: string; use: string; sample: string }[] = [
  { token: "type-display-l", spec: "57/64 · 400 · -0.25px", use: "Rare: a single hero figure", sample: "14 days" },
  { token: "type-display-m", spec: "45/52 · 400", use: "Countdown days on the featured exam", sample: "9 days" },
  { token: "type-display-s", spec: "36/44 · 400", use: "End-screen accuracy", sample: "83% accuracy" },
  { token: "type-headline-l", spec: "32/40 · 400", use: "Status words in big cards", sample: "Today" },
  { token: "type-headline-m", spec: "28/36 · 400", use: "Lesson question (700 in sessions)", sample: "What does a stack frame hold?" },
  { token: "type-headline-s", spec: "24/32 · 400", use: "View headlines, dialog titles", sample: "Prelim 1 plan" },
  { token: "type-title-l", spec: "22/28 · 400", use: "Top app bar title", sample: "Study guides" },
  { token: "type-title-m", spec: "16/24 · 500 · 0.15px", use: "Section and card titles", sample: "Weak spots" },
  { token: "type-title-s", spec: "14/20 · 500 · 0.1px", use: "Small titles, table heads", sample: "Follow-up sessions" },
  { token: "type-body-l", spec: "16/24 · 400 · 0.5px", use: "Reading text, explanations", sample: "Answer from memory, then check against the model answer." },
  { token: "type-body-m", spec: "14/20 · 400 · 0.25px", use: "Default UI text", sample: "Sessions in this plan fall between these times each day." },
  { token: "type-body-s", spec: "12/16 · 400 · 0.4px", use: "Helper text, captions", sample: "Use at least 8 characters." },
  { token: "type-label-l", spec: "14/20 · 500 · 0.1px", use: "Buttons, field labels", sample: "Create plan" },
  { token: "type-label-m", spec: "12/16 · 500 · 0.5px", use: "Nav labels, chips", sample: "Progress" },
  { token: "type-label-s", spec: "11/16 · 500 · 0.5px", use: "Key hints", sample: "Ctrl+Enter" },
]

const RADII = [
  { token: "rounded-sm", value: "4px", use: "Tooltips, key hints, snackbar" },
  { token: "rounded-md", value: "8px", use: "Text fields, menus, selects" },
  { token: "rounded-lg", value: "12px", use: "Alerts, list rows" },
  { token: "rounded-2xl", value: "16px", use: "Cards, answer options, lesson buttons" },
  { token: "rounded-4xl", value: "28px", use: "Dialogs, bottom sheets" },
  { token: "rounded-full", value: "pill", use: "Buttons, chips, nav indicators" },
]

const ELEVATION = [
  { token: "flat", className: "ring-1 ring-border", use: "Cards at rest: tonal, hairline" },
  { token: "shadow-sm", className: "shadow-sm", use: "Hovered card, filled button hover" },
  { token: "shadow-md", className: "shadow-md", use: "Menus, popovers, selects" },
  { token: "shadow-lg", className: "shadow-lg", use: "Dialogs, sheets, snackbar" },
]

const MOTION = [
  { token: "--duration-short", value: "150ms", use: "State layers, colour changes, presses" },
  { token: "--duration-medium", value: "250ms", use: "Progress, sheets opening" },
  { token: "--duration-long", value: "350ms", use: "Feedback sheet sliding up" },
  { token: "--duration-dial", value: "450ms", use: "The roundness dial entering a session" },
  { token: "ease-standard", value: "cubic-bezier(0.2, 0, 0, 1)", use: "State changes" },
  { token: "ease-emphasized", value: "cubic-bezier(0.05, 0.7, 0.1, 1)", use: "Entrances" },
]

const ICONS = [HouseIcon, CalendarDaysIcon, GraduationCapIcon, LayersIcon, BookOpenTextIcon, MessagesSquareIcon, ChartColumnIcon, SettingsIcon, CheckIcon, CircleAlertIcon]

export function Foundations() {
  return (
    <ShowcaseSection
      id="foundations"
      title="Foundations"
      description="Google Material 3 roles for the shell, Google's product colours in Duolingo's grammar for sessions. Each pair shows the contrast measured live in the current theme."
    >
      <Block title="Colour roles: shell" description="Text pairs need 4.5:1, UI parts 3:1.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SHELL_PAIRS.map((p) => (
            <ColorPair key={p.name} name={p.name} background={p.bg} foreground={p.fg} min={p.min} />
          ))}
        </div>
      </Block>

      <Block title="Colour roles: lessons" description="Used only inside the .lesson scope of /s/[sessionId].">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {LESSON_PAIRS.map((p) => (
            <ColorPair key={p.name} name={p.name} background={p.bg} foreground={p.fg} min={p.min} />
          ))}
        </div>
      </Block>

      <Block title="Palette">
        <div className="flex flex-col gap-6">
          {SWATCHES.map((group) => (
            <div key={group.group} className="flex flex-col gap-2">
              <h4 className="type-title-s text-on-surface-variant">{group.group}</h4>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-7">
                {group.tokens.map((token) => (
                  <div key={token} className="flex flex-col gap-1.5">
                    <div
                      className="h-12 rounded-lg ring-1 ring-border"
                      style={{ backgroundColor: `var(--${token})` }}
                    />
                    <span className="truncate font-mono text-[0.6875rem] text-on-surface-variant">{token}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="Type scale" description="Google Sans Flex. Fixed rem sizes as type-* utilities, never text-* sizes.">
        <div className="flex flex-col divide-y divide-border">
          {TYPE_SCALE.map((row) => (
            <div key={row.token} className="grid gap-1 py-3 md:grid-cols-[11rem_12rem_1fr] md:items-baseline md:gap-4">
              <code className="font-mono text-xs text-on-surface">{row.token}</code>
              <span className="type-body-s text-on-surface-variant">
                {row.spec}
                <span className="block">{row.use}</span>
              </span>
              <span className={`${row.token} min-w-0 truncate text-on-surface`}>{row.sample}</span>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-prose type-body-l text-on-surface">
          Running text sits at body-l with a 65 to 75 character measure.{" "}
          <a href="#lesson" className="text-primary underline">
            Links
          </a>{" "}
          underline, and code such as <code className="rounded-sm bg-surface-container px-1 font-mono text-sm">useActiveCourse()</code>{" "}
          uses Google Sans Code. Times and scores use tabular figures: <span className="tabular-nums">2:00 – 2:30 PM, 83%</span>.
        </p>
      </Block>

      <Block
        title="The roundness dial"
        description="The shell sets ROND 0 with weights 400 and 500. Sessions set ROND 100 and step the weight up to 500 for body and 700 for questions and buttons."
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-xl bg-surface-container p-4">
            <span className="type-label-m text-on-surface-variant">Shell · ROND 0</span>
            <span className="type-headline-s text-on-surface">What does a stack frame hold?</span>
            <span className="type-body-m text-on-surface-variant">Answer from memory before you check anything.</span>
          </div>
          <div className="lesson flex flex-col gap-2 rounded-xl p-4 ring-1 ring-lesson-option-border">
            <span className="type-label-m text-lesson-muted">Session · ROND 100</span>
            <span className="type-headline-s font-bold">What does a stack frame hold?</span>
            <span className="type-body-m text-lesson-muted">Answer from memory before you check anything.</span>
          </div>
        </div>
      </Block>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Shape">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {RADII.map((r) => (
              <div key={r.token} className="flex flex-col gap-2">
                <div className={`h-14 border-2 border-primary bg-primary-container ${r.token}`} />
                <span className="font-mono text-xs text-on-surface">
                  {r.token} · {r.value}
                </span>
                <span className="type-body-s text-on-surface-variant">{r.use}</span>
              </div>
            ))}
          </div>
        </Block>
        <Block title="Elevation" description="Tonal first. Shadows only where something floats.">
          <div className="grid grid-cols-2 gap-4">
            {ELEVATION.map((e) => (
              <div key={e.token} className="flex flex-col gap-2">
                <div className={`h-14 rounded-2xl bg-surface-container-lowest ${e.className}`} />
                <span className="font-mono text-xs text-on-surface">{e.token}</span>
                <span className="type-body-s text-on-surface-variant">{e.use}</span>
              </div>
            ))}
          </div>
        </Block>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Motion" description="Motion only conveys state, and all of it stops under reduced motion.">
          <div className="flex flex-col divide-y divide-border">
            {MOTION.map((m) => (
              <div key={m.token} className="grid grid-cols-[9.5rem_1fr] gap-3 py-2">
                <code className="font-mono text-xs text-on-surface">{m.token}</code>
                <span className="type-body-s text-on-surface-variant">
                  <span className="text-on-surface">{m.value}</span> · {m.use}
                </span>
              </div>
            ))}
          </div>
        </Block>
        <Block title="Icons" description="lucide-react only, stroke 2, rounded joins, aria-hidden beside a text label.">
          <div className="flex flex-col gap-4">
            {[
              { cls: "size-4 text-on-surface", label: "16px" },
              { cls: "size-5 text-on-surface", label: "20px" },
              { cls: "size-6 text-on-surface-variant", label: "24px" },
            ].map((row) => (
              <div key={row.label} className="flex flex-wrap items-center gap-4">
                <span className="w-10 font-mono text-xs text-on-surface-variant">{row.label}</span>
                {ICONS.map((Icon, i) => (
                  <Icon key={i} className={row.cls} aria-hidden="true" />
                ))}
              </div>
            ))}
          </div>
        </Block>
      </div>
    </ShowcaseSection>
  )
}
