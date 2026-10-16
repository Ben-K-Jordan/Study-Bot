/** What the upload route accepts, checked in the browser before sending. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024

/** For the file picker. Extensions first: browsers often give .md no type. */
export const ACCEPTED_FILES = ".pdf,.txt,.md,.markdown,application/pdf,text/plain,text/markdown"

const EXTENSIONS = new Set(["pdf", "txt", "md", "markdown"])
const TYPES = new Set(["application/pdf", "text/plain", "text/markdown", "text/x-markdown"])

export const FILE_RULE = "Upload a PDF, text, or Markdown file up to 10 MB."

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ""
}

/** Null when the file can be uploaded, else the sentence that says why not. */
export function fileProblem(file: { name: string; size: number; type: string }): string | null {
  const typeOk = TYPES.has(file.type) || EXTENSIONS.has(extensionOf(file.name))
  if (!typeOk || file.size > MAX_FILE_BYTES) return FILE_RULE
  if (file.size === 0) return "This file is empty. Choose a file with text in it."
  return null
}

/** "PDF", "Text", or "Markdown" for a file's kind. */
export function fileKind(name: string, mimeType?: string): string {
  const ext = extensionOf(name)
  if (ext === "pdf" || mimeType === "application/pdf") return "PDF"
  if (ext === "md" || ext === "markdown" || mimeType?.includes("markdown")) return "Markdown"
  return "Text"
}
