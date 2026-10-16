/**
 * Sessions Reschedule skipped leave Google Calendar on the next publish:
 * their events are deleted once, and no event is created for them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const client = {
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  listEvents: vi.fn(),
};

vi.mock("@/lib/google/calendar-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/google/calendar-client")>();
  return { ...actual, getGoogleClient: () => client };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    studyPlan: { findUnique: vi.fn() },
    googleIntegration: { findUnique: vi.fn() },
    planCalendarPublication: { findUnique: vi.fn(), upsert: vi.fn() },
    planItemExternalEvent: { findMany: vi.fn(), delete: vi.fn(), create: vi.fn(), update: vi.fn() },
    session: { findMany: vi.fn() },
  },
}));

import { publishPlanToGoogle } from "@/services/publish";
import { GoogleApiError } from "@/lib/google/calendar-client";
import { prisma } from "@/lib/db";

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>;

const item = (id: string, status: string) => ({
  id,
  sessionId: `s-${id}`,
  dayIndex: 0,
  status,
  startTime: new Date("2026-10-16T13:00:00Z"),
  endTime: new Date("2026-10-16T14:00:00Z"),
});

const session = (id: string) => ({
  sessionId: `s-${id}`,
  courseName: "CS 2110",
  examName: "Prelim 1",
  mode: "RETRIEVAL",
  topicScope: "Recursion",
  plannedMinutes: 60,
  objectives: [{ id: "recursion", title: "Recursion" }],
  targetOutcome: { prompt_count: 8, target_accuracy: 0.8 },
  breakProtocol: { type: "25_5", cycles: 1 },
});

const mapping = (itemId: string) => ({
  id: `m-${itemId}`,
  planItemId: itemId,
  calendarId: "primary",
  eventId: `e-${itemId}`,
  htmlLink: null,
  lastSyncedHash: "old",
});

describe("publishPlanToGoogle with skipped sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock(prisma.studyPlan.findUnique).mockResolvedValue({
      planId: "plan-1",
      userId: "user-1",
      timezone: "America/New_York",
      items: [item("kept", "SCHEDULED"), item("skipped", "SKIPPED"), item("new-skip", "SKIPPED")],
    });
    mock(prisma.googleIntegration.findUnique).mockResolvedValue({
      status: "CONNECTED",
      calendarIdSelected: "primary",
    });
    mock(prisma.planCalendarPublication.findUnique).mockResolvedValue({ calendarId: "primary", status: "PUBLISHED" });
    // "new-skip" never had an event
    mock(prisma.planItemExternalEvent.findMany).mockResolvedValue([mapping("kept"), mapping("skipped")]);
    mock(prisma.session.findMany).mockResolvedValue([session("kept"), session("skipped"), session("new-skip")]);
    client.updateEvent.mockImplementation(async (_cal: string, eventId: string) => ({ id: eventId }));
    client.deleteEvent.mockResolvedValue(undefined);
  });

  it("deletes the skipped session's event and creates none for skipped sessions", async () => {
    const result = await publishPlanToGoogle("user-1", "plan-1");
    if (!("data" in result)) throw new Error("expected data");

    expect(client.deleteEvent).toHaveBeenCalledWith("primary", "e-skipped");
    expect(mock(prisma.planItemExternalEvent.delete)).toHaveBeenCalledWith({ where: { id: "m-skipped" } });
    expect(client.createEvent).not.toHaveBeenCalled();
    expect(client.updateEvent).toHaveBeenCalledTimes(1);
    expect(result.data.status).toBe("OK");
    expect(result.data.summary).toMatchObject({ updated: 1, removed: 1, failed: 0, total: 1 });
  });

  it("keeps the mapping when the delete fails, without failing the publish", async () => {
    client.deleteEvent.mockRejectedValueOnce(new GoogleApiError("Backend Error", 500));
    const result = await publishPlanToGoogle("user-1", "plan-1");
    if (!("data" in result)) throw new Error("expected data");

    expect(mock(prisma.planItemExternalEvent.delete)).not.toHaveBeenCalled();
    expect(result.data.status).toBe("OK");
    expect(result.data.summary).toMatchObject({ removed: 0, total: 1 });
    expect(result.data.warnings?.length).toBe(1);
  });
});
