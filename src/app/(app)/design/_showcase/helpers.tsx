"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

// Resolves any CSS colour to sRGB by painting one pixel, compositing
// translucent colours over the backdrop as the browser would.
function toRgb(color: string, backdrop = "#fff") {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d", { willReadFrequently: true })
  if (!context) return null
  context.fillStyle = backdrop
  context.fillRect(0, 0, 1, 1)
  context.fillStyle = color
  context.fillRect(0, 0, 1, 1)
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data
  return [r, g, b]
}

function toHex(rgb: number[]) {
  return `#${rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`
}

function luminance([r, g, b]: number[]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * R + 0.7152 * G + 0.0722 * B
}

function contrast(a: number[], b: number[]) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** A surface with "Aa" in its foreground colour and the live contrast ratio. */
export function ColorPair({
  name,
  background,
  foreground,
  min = 4.5,
}: {
  name: string
  background: string
  foreground: string
  /** 4.5 for text, 3 for UI parts and large text. */
  min?: number
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const [info, setInfo] = React.useState<{ ratio: number; bg: string; fg: string } | null>(null)

  React.useEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      const page = getComputedStyle(document.body).backgroundColor
      const bg = toRgb(style.backgroundColor, page)
      if (!bg) return
      const fg = toRgb(style.color, toHex(bg))
      if (fg) setInfo({ ratio: contrast(bg, fg), bg: toHex(bg), fg: toHex(fg) })
    }
    measure()
    const observer = new MutationObserver(() => requestAnimationFrame(measure))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])

  const pass = info ? info.ratio >= min : true

  return (
    <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-border">
      <div
        ref={ref}
        style={{ backgroundColor: `var(--${background})`, color: `var(--${foreground})` }}
        className="flex h-20 items-end justify-between p-3"
      >
        <span className="type-headline-s">Aa</span>
        {info ? (
          <span className="rounded-full border border-current/30 px-2 py-0.5 font-mono text-xs tabular-nums">
            {info.ratio.toFixed(2)}
            {pass ? "" : " below " + min}
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5 bg-card p-3">
        <span className="type-label-l text-on-surface">{name}</span>
        <span className="truncate font-mono text-[0.6875rem] text-on-surface-variant">
          {foreground} on {background}
        </span>
        {info ? (
          <span className="font-mono text-[0.6875rem] text-on-surface-variant">
            {info.fg} on {info.bg}
          </span>
        ) : null}
      </div>
    </div>
  )
}

const defaultStates = ["default", "hover", "focus", "active", "disabled"] as const

/** A labelled variant by state table; each cell renders one pinned state. */
export function StateMatrix<Row extends string>({
  rows,
  states = defaultStates,
  render,
  className,
}: {
  rows: readonly Row[]
  states?: readonly string[]
  render: (row: Row, state: string) => React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <table className="border-separate border-spacing-x-3 border-spacing-y-4">
        <thead>
          <tr>
            <th />
            {states.map((state) => (
              <th key={state} scope="col" className="text-left font-mono text-xs font-normal text-on-surface-variant">
                {state}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row" className="pr-2 text-left font-mono text-xs font-normal text-on-surface-variant">
                {row}
              </th>
              {states.map((state) => (
                <td key={state} className="align-middle">
                  {render(row, state)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Spread onto a component to pin a state without interaction. */
export function previewState(state: string): Record<string, unknown> {
  if (state === "disabled") return { disabled: true }
  if (["hover", "focus", "active"].includes(state)) return { "data-preview": state }
  return {}
}

/** One section of the page, with an anchor and an h2. */
export function ShowcaseSection({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex scroll-mt-24 flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-border pb-3">
        <h2 id={`${id}-title`} className="type-headline-s text-on-surface">
          {title}
        </h2>
        {description ? <p className="max-w-prose type-body-m text-on-surface-variant">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** A labelled block inside a section. */
export function Block({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      <div className="flex flex-col gap-0.5">
        <h3 className="type-title-m text-on-surface">{title}</h3>
        {description ? <p className="max-w-prose type-body-m text-on-surface-variant">{description}</p> : null}
      </div>
      <div className="rounded-2xl bg-card p-5 ring-1 ring-border">{children}</div>
    </div>
  )
}
