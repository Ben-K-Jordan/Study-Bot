import { LOCALE } from "@/lib/format"

/** Used where the runtime can't list its zones (Intl.supportedValuesOf). */
const FALLBACK_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Mexico_City",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Madrid",
  "Africa/Cairo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "Pacific/Auckland",
]

export interface ZoneOption {
  id: string
  /** The place, as people say it: "New York", "Buenos Aires, Argentina". */
  label: string
}

export interface ZoneGroup {
  /** Region heading ("America", "Europe"); empty for UTC. */
  region: string
  zones: ZoneOption[]
}

/** "America/Argentina/Buenos_Aires" -> "Buenos Aires, Argentina" */
export function zonePlace(id: string): string {
  const parts = id.split("/").slice(1).map((p) => p.replaceAll("_", " "))
  if (parts.length === 0) return id
  return parts.reverse().join(", ")
}

let cachedGroups: ZoneGroup[] | null = null

/** Every IANA zone the runtime knows, grouped by region, plus UTC first. */
export function zoneGroups(): ZoneGroup[] {
  if (cachedGroups) return cachedGroups
  let ids: string[]
  try {
    ids =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : FALLBACK_ZONES
  } catch {
    ids = FALLBACK_ZONES
  }
  const byRegion = new Map<string, ZoneOption[]>()
  for (const id of ids) {
    if (!id.includes("/") || id.startsWith("Etc/")) continue
    const region = id.split("/")[0]
    const list = byRegion.get(region) ?? []
    list.push({ id, label: zonePlace(id) })
    byRegion.set(region, list)
  }
  const regions = [...byRegion.keys()].sort()
  cachedGroups = [
    { region: "", zones: [{ id: "UTC", label: "UTC" }] },
    ...regions.map((region) => ({
      region,
      zones: (byRegion.get(region) ?? []).toSorted((a, b) => a.label.localeCompare(b.label, LOCALE)),
    })),
  ]
  return cachedGroups
}

/** Whether `id` is in the list `zoneGroups()` offers. */
export function isListedZone(id: string): boolean {
  return zoneGroups().some((g) => g.zones.some((z) => z.id === id))
}

const genericNames = new Map<string, string | null>()

/** "Eastern Time" for America/New_York, or null if Intl has no name. */
function genericName(id: string): string | null {
  if (genericNames.has(id)) return genericNames.get(id) ?? null
  let name: string | null = null
  try {
    const part = new Intl.DateTimeFormat(LOCALE, { timeZone: id, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")
    name = part?.value ?? null
  } catch {
    name = null
  }
  genericNames.set(id, name)
  return name
}

/** "New York (Eastern Time)", "UTC", or the id itself for unknown zones. */
export function zoneDisplayName(id: string): string {
  if (id === "UTC") return "UTC"
  const place = zonePlace(id)
  const generic = genericName(id)
  return generic && generic !== place ? `${place} (${generic})` : place
}

/** The zone this device is set to, or null when the browser won't say. */
export function deviceTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    return null
  }
}
