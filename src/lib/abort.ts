/**
 * A signal that aborts when any of `signals` does, with that signal's reason.
 * Uses AbortSignal.any where it exists; Safari before 17.4 and Firefox before
 * 124 don't have it (both are in Next's default browser targets), so there it
 * links the signals by hand.
 */
export function anySignal(...signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals)
  const controller = new AbortController()
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason)
      return controller.signal
    }
  }
  const cleanups: (() => void)[] = []
  const abort = (signal: AbortSignal) => {
    for (const cleanup of cleanups) cleanup()
    controller.abort(signal.reason)
  }
  for (const signal of signals) {
    const onAbort = () => abort(signal)
    signal.addEventListener("abort", onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener("abort", onAbort))
  }
  return controller.signal
}
