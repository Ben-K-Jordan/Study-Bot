/**
 * Print stylesheet for Study guides: the guide marked data-guide-print
 * prints alone, black on white, without the app's navigation, top bar,
 * toasts or controls. Borders use the light theme's outline colour, since
 * paper is always light. Rendered as a React 19 hoisted <style>, so it loads
 * only on the pages that print guides and leaves globals.css alone.
 */
const GUIDE_PRINT_CSS = `
@media print {
  @page { margin: 16mm 14mm; }
  html, body { background: #fff !important; color: #000 !important; }
  body:has([data-guide-print]) :is(nav, header, [data-sonner-toaster]):not([data-guide-print] *) {
    display: none !important;
  }
  body:has([data-guide-print]) #main-content { padding: 0 !important; }
  body:has([data-guide-print]) #main-content > * { max-width: none !important; padding: 0 !important; }
  body:has([data-guide-print]) :has(> #main-content) { padding-left: 0 !important; }
  [data-guide-print] {
    box-shadow: none !important;
    border: 0 !important;
    outline: 0 !important;
    padding: 0 !important;
  }
  [data-guide-print], [data-guide-print] * {
    color: #000 !important;
    background: transparent !important;
    border-color: #747775 !important;
    box-shadow: none !important;
  }
  [data-guide-print] a { text-decoration: underline; }
  [data-guide-print] :is(h2, h3, h4) { break-after: avoid; }
  [data-guide-print] [data-guide-section] { break-inside: avoid; }
  [data-guide-print] pre, [data-guide-print] table { break-inside: avoid; }
  [data-guide-print] [data-slot="table-container"], [data-guide-print] pre { overflow: visible !important; white-space: pre-wrap; }
}
`

export function GuidePrintStyles() {
  return (
    <style href="study-bot-guide-print" precedence="default">
      {GUIDE_PRINT_CSS}
    </style>
  )
}
