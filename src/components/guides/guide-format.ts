/**
 * Study guide formats, section cleanup and the Markdown export. Pure, so
 * the guides service (when it saves and lists guides) and the Study guides
 * screen (when it renders and exports them) share one definition.
 */

export const GUIDE_TYPES = ["KEY_CONCEPTS", "FAQ", "CHEAT_SHEET"] as const

export type GuideType = (typeof GUIDE_TYPES)[number]

export interface GuideFormat {
  type: GuideType
  /** Tab label and the noun in sentences ("No FAQ for Prelim 2 yet"). */
  label: string
  /** Lowercase form for the middle of a sentence. */
  noun: string
  /** URL value for ?format= */
  slug: string
  description: string
}

export const GUIDE_FORMATS: readonly GuideFormat[] = [
  {
    type: "KEY_CONCEPTS",
    label: "Key concepts",
    noun: "key concepts guide",
    slug: "key-concepts",
    description: "The main ideas, each explained with why it matters.",
  },
  {
    type: "FAQ",
    label: "FAQ",
    noun: "FAQ",
    slug: "faq",
    description: "Common points of confusion, as questions and answers.",
  },
  {
    type: "CHEAT_SHEET",
    label: "Cheat sheet",
    noun: "cheat sheet",
    slug: "cheat-sheet",
    description: "Definitions, formulas, and lists in a short sheet you can print.",
  },
]

export function isGuideType(value: unknown): value is GuideType {
  return typeof value === "string" && (GUIDE_TYPES as readonly string[]).includes(value)
}

export function guideFormat(type: GuideType): GuideFormat {
  return GUIDE_FORMATS.find((f) => f.type === type) ?? GUIDE_FORMATS[0]
}

export function guideTypeFromSlug(slug: string | null | undefined): GuideType | null {
  if (!slug) return null
  return GUIDE_FORMATS.find((f) => f.slug === slug || f.type === slug)?.type ?? null
}

/** One section of a guide. Which fields are set depends on the format. */
export interface GuideSection {
  // KEY_CONCEPTS
  concept?: string
  explanation?: string
  importance?: string
  // FAQ
  question?: string
  answer?: string
  // CHEAT_SHEET
  topic?: string
  content?: string
}

const SECTION_FIELDS = [
  "concept",
  "explanation",
  "importance",
  "question",
  "answer",
  "topic",
  "content",
] as const satisfies readonly (keyof GuideSection)[]

/**
 * Turns any JSON value into Markdown text. Models sometimes return a list
 * or a table as an array or an object instead of a string; rendering those
 * directly would crash the page, so they become Markdown lists, tables or
 * "key: value" lines.
 */
export function toGuideText(value: unknown, depth = 0): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (depth > 3) return ""

  if (Array.isArray(value)) {
    const rows = value.filter((v) => v !== null && v !== undefined)
    if (rows.length === 0) return ""
    // An array of equal-length arrays of scalars reads as a table.
    if (rows.every((r) => Array.isArray(r) && r.every((c) => typeof c !== "object" || c === null))) {
      const width = Math.max(...rows.map((r) => (r as unknown[]).length))
      if (width > 1) {
        const cell = (c: unknown) => toGuideText(c, depth + 1).replace(/\|/g, "\\|").replace(/\n/g, " ")
        const line = (r: unknown[]) =>
          `| ${Array.from({ length: width }, (_, i) => cell(r[i])).join(" | ")} |`
        const [head, ...body] = rows as unknown[][]
        return [line(head), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`, ...body.map(line)].join("\n")
      }
    }
    return rows
      .map((item) => {
        const text = toGuideText(item, depth + 1)
        if (!text) return ""
        const [first, ...rest] = text.split("\n")
        return [`- ${first}`, ...rest.map((l) => `  ${l}`)].join("\n")
      })
      .filter(Boolean)
      .join("\n")
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => {
        const text = toGuideText(v, depth + 1)
        if (!text) return ""
        return text.includes("\n") ? `${key}:\n${text}` : `${key}: ${text}`
      })
      .filter(Boolean)
      .join("\n")
  }

  return ""
}

/** Sections as clean strings, whatever shape the stored JSON has. */
export function normalizeGuideSections(raw: unknown): GuideSection[] {
  let list: unknown[] = []
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === "object") {
    const nested = (raw as { sections?: unknown }).sections
    list = Array.isArray(nested) ? nested : Object.values(raw as Record<string, unknown>)
  }

  const sections: GuideSection[] = []
  for (const item of list) {
    if (typeof item === "string") {
      const text = item.trim()
      if (text) sections.push({ content: text })
      continue
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const section: GuideSection = {}
    for (const field of SECTION_FIELDS) {
      const text = toGuideText((item as Record<string, unknown>)[field])
      if (text) section[field] = text
    }
    if (Object.keys(section).length > 0) sections.push(section)
  }
  return sections
}

/** The old fallback titles ("KEY CONCEPTS Guide") and empty titles get a readable one. */
export function guideTitle(title: unknown, type: GuideType, scopeName: string): string {
  const text = typeof title === "string" ? title.trim() : ""
  if (!text || /^(KEY CONCEPTS|FAQ|CHEAT SHEET) Guide$/i.test(text)) {
    return `${guideFormat(type).label} for ${scopeName}`
  }
  return text
}

/**
 * The Markdown export. The layout matches earlier exports: a title, then
 * each section's lines, sections separated by horizontal rules.
 */
export function guideToMarkdown(guide: { title: string; sections: readonly GuideSection[] }): string {
  const body = guide.sections
    .map((s) => {
      const parts: string[] = []
      if (s.concept) parts.push(`## ${s.concept}`)
      if (s.question) parts.push(`**Q: ${s.question}**`)
      if (s.topic) parts.push(`## ${s.topic}`)
      if (s.explanation) parts.push(s.explanation)
      if (s.answer) parts.push(s.answer)
      if (s.content) parts.push(s.content)
      if (s.importance) parts.push(`_Why it matters: ${s.importance}_`)
      return parts.join("\n")
    })
    .join("\n\n---\n\n")
  return `# ${guide.title}\n\n${body}`
}

/** "Prelim 2 cheat sheet" becomes "prelim-2-cheat-sheet.md"; no usable characters gives "study-guide.md". */
export function guideFileName(title: string): string {
  const slug = title
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase()
  return `${slug || "study-guide"}.md`
}
