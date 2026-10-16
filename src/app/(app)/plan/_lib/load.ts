/**
 * Server-side reads for the Plan screens. Everything goes through the
 * services layer with the signed-in user's id; nothing here runs in the
 * browser.
 */
import { prisma } from "@/lib/db"
import { getUserTimezone, isValidTimezone } from "@/lib/timezone"
import { getPlanView, listPlanSummaries, type PlanSummary, type PlanView } from "@/services/plan"
import { listDocuments } from "@/services/content"
import { getPublishStatus } from "@/services/publish"
import { sortPlans } from "@/components/plan/plan-model"
import { lastCalendarAction, type CalendarState } from "@/components/plan/calendar-types"
import type { MaterialDoc } from "@/components/materials/types"

const FALLBACK_ZONE = "America/New_York"

/** The zone dates are shown in: the student's setting, else the given plan's zone. */
export async function displayTimeZone(userId: string, planZone?: string | null): Promise<string> {
  const setting = await getUserTimezone(userId)
  for (const zone of [setting, planZone]) {
    if (zone && isValidTimezone(zone)) return zone
  }
  return FALLBACK_ZONE
}

async function googleConnection(userId: string): Promise<CalendarState["connection"]> {
  const integration = await prisma.googleIntegration.findUnique({
    where: { userId },
    select: { status: true },
  })
  if (!integration) return "not_connected"
  return integration.status === "CONNECTED" ? "connected" : "reconnect"
}

async function calendarState(userId: string, view: PlanView): Promise<CalendarState> {
  const [connection, status] = await Promise.all([
    googleConnection(userId),
    getPublishStatus(userId, view.plan_id),
  ])
  const publication = "data" in status ? status.data.publication : null
  const added = "data" in status ? status.data.items.length : 0
  return {
    // Hide Google options on a server without Google credentials, unless
    // the student already connected (so existing events stay manageable).
    configured: Boolean(process.env.GOOGLE_CLIENT_ID) || connection !== "not_connected",
    connection,
    publication: publication
      ? {
          status: publication.status as NonNullable<CalendarState["publication"]>["status"],
          added,
          // Skipped sessions don't belong in the calendar
          total: view.counts.total,
          last_action: lastCalendarAction(publication),
          last_error: publication.last_error,
        }
      : null,
  }
}

export type PlanPageData =
  | { kind: "empty"; timeZone: string }
  | {
      kind: "plan"
      timeZone: string
      plans: PlanSummary[]
      view: PlanView
      calendar: CalendarState
      materials: MaterialDoc[]
    }
  | { kind: "missing"; timeZone: string; plans: PlanSummary[] }

/** Everything /plan shows: the plan list, the chosen plan, its calendar status and materials. */
export async function loadPlanPage(userId: string, planId: string | undefined): Promise<PlanPageData> {
  const now = new Date()
  // Start the selected plan's read with the list when the URL names it
  const [summaries, requested, userZone] = await Promise.all([
    listPlanSummaries(userId, now),
    planId ? getPlanView(userId, planId, now) : Promise.resolve(null),
    getUserTimezone(userId),
  ])

  const zoneFor = (planZone?: string) =>
    [userZone, planZone].find((z): z is string => !!z && isValidTimezone(z)) ?? FALLBACK_ZONE

  if (summaries.length === 0) return { kind: "empty", timeZone: zoneFor() }

  const listZone = zoneFor(summaries[0].timezone)
  const plans = sortPlans(summaries, { timeZone: listZone, now })

  let result = requested
  if (!planId) result = await getPlanView(userId, plans[0].plan_id, now)
  if (!result || "error" in result) return { kind: "missing", timeZone: listZone, plans }

  const view = result.data
  const [calendar, documents] = await Promise.all([
    calendarState(userId, view),
    listDocuments(userId, "COURSE", view.course_name),
  ])

  return {
    kind: "plan",
    timeZone: zoneFor(view.timezone),
    plans,
    view,
    calendar,
    materials: documents.map(toMaterialDoc),
  }
}

export function toMaterialDoc(doc: Awaited<ReturnType<typeof listDocuments>>[number]): MaterialDoc {
  return {
    document_id: doc.document_id,
    course_name: doc.course_name,
    exam_name: doc.exam_name,
    title: doc.title,
    original_filename: doc.original_filename,
    mime_type: doc.mime_type,
    status: doc.status,
    chunk_count: doc.chunk_count,
    summary: doc.summary,
    suggested_questions: doc.suggested_questions,
    created_at: doc.created_at,
  }
}

/**
 * The New plan form's defaults: study hours from Settings, known courses,
 * existing plans, and the time zone saved in Settings (null when there is
 * none, so the form sends the browser's instead).
 */
export async function loadNewPlanDefaults(userId: string) {
  const [state, summaries, documents, setting] = await Promise.all([
    prisma.userGameState.findUnique({
      where: { userId },
      select: { studyStartTime: true, studyEndTime: true, dailyStudyCap: true },
    }),
    listPlanSummaries(userId),
    listDocuments(userId, "COURSE"),
    getUserTimezone(userId),
  ])
  const savedTimeZone = setting && isValidTimezone(setting) ? setting : null

  return {
    timeZone: savedTimeZone ?? FALLBACK_ZONE,
    savedTimeZone,
    studyStart: state?.studyStartTime ?? "09:00",
    studyEnd: state?.studyEndTime ?? "17:00",
    dailyCap: state?.dailyStudyCap ?? 180,
    plans: summaries,
    materials: documents.map(toMaterialDoc),
  }
}

/** The Materials screen: every course file, plus course names from plans with no files yet. */
export async function loadMaterials(userId: string) {
  const [documents, summaries, timeZone] = await Promise.all([
    listDocuments(userId, "COURSE"),
    listPlanSummaries(userId),
    displayTimeZone(userId),
  ])
  return {
    timeZone,
    materials: documents.map(toMaterialDoc),
    plans: sortPlans(summaries, { timeZone }),
  }
}
