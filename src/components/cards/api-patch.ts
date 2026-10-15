import { ApiError } from "@/lib/client-api"

/**
 * PATCH with the same error handling as apiPost (src/lib/client-api.ts has
 * no PATCH helper yet). Rejects with ApiError on a non-2xx.
 */
export async function apiPatch(url: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  if (!res.ok) {
    const message = (data as { error?: unknown } | null)?.error
    throw new ApiError(typeof message === "string" ? message : "Not saved.", res.status, data)
  }
  return data
}
