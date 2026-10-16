/**
 * Keeps each numbered source marker on the line of the word before it, for
 * Markdown rendered with react-markdown (the session runner's AI text and
 * chat answers). Pure: it only rewrites the HTML syntax tree.
 */

/** The runner's source links ("#source-2") and chat's `cite-ref` elements. */
export const CITATION_HREF = /^#source-(\d+)$/

/** The bits of a hast (HTML syntax tree) node this file reads. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

function isCitation(node: HastNode | undefined): boolean {
  if (node?.type !== "element") return false
  if (node.tagName === "cite-ref") return true
  return node.tagName === "a" && typeof node.properties?.href === "string" && CITATION_HREF.test(node.properties.href)
}

/**
 * Keeps each numbered source button on the line of the word before it.
 * A button is an atomic inline, and browsers may break a line before one
 * even after a no-break space or a word joiner (CSS Text 3, 5.1), so the
 * pill could drop to a line of its own. This rehype step wraps the last
 * word and the citation (or a run like "[1] [2]") in a nowrap span.
 */
export function rehypeKeepCitationsWithText() {
  return (tree: HastNode) => keepCitationsWithText(tree)
}

function keepCitationsWithText(parent: HastNode): void {
  const children = parent.children
  if (!children) return
  const out: HastNode[] = []
  for (let i = 0; i < children.length; i++) {
    const child = children[i]
    if (!isCitation(child)) {
      keepCitationsWithText(child)
      out.push(child)
      continue
    }
    // The citation, and any more that follow it with only spaces between.
    const group: HastNode[] = [child]
    let next = i + 1
    while (next < children.length) {
      const node = children[next]
      if (isCitation(node)) {
        group.push(node)
        next++
      } else if (node.type === "text" && /^\s*$/.test(node.value ?? "") && isCitation(children[next + 1])) {
        group.push(node)
        next++
      } else {
        break
      }
    }
    // The word right before it, with the space between.
    const lead: HastNode[] = []
    const previous = out[out.length - 1]
    if (previous?.type === "text" && previous.value) {
      const word = previous.value.match(/\S+\s*$/)?.[0]
      if (word) {
        previous.value = previous.value.slice(0, previous.value.length - word.length)
        if (!previous.value) out.pop()
        lead.push({ type: "text", value: word })
      }
    }
    out.push({
      type: "element",
      tagName: "span",
      properties: { className: ["whitespace-nowrap"] },
      children: [...lead, ...group],
    })
    i = next - 1
  }
  parent.children = out
}
