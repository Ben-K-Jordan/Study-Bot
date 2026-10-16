/**
 * Google Calendar availability: the fake provider connects without any
 * client id (as the connect route does), so a default development setup
 * shows the calendar instead of asking for real OAuth credentials.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { isGoogleCalendarAvailable } from "@/lib/google/availability";
import { publicConfig } from "@/lib/public-config";

describe("isGoogleCalendarAvailable", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is available with the fake provider and no client id", () => {
    vi.stubEnv("GOOGLE_PROVIDER", "fake");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(isGoogleCalendarAvailable()).toBe(true);
    expect(publicConfig().google_configured).toBe(true);
  });

  it("needs a client id for the real provider", () => {
    vi.stubEnv("GOOGLE_PROVIDER", "real");
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    expect(isGoogleCalendarAvailable()).toBe(false);
    expect(publicConfig().google_configured).toBe(false);

    vi.stubEnv("GOOGLE_CLIENT_ID", "client-id.apps.googleusercontent.com");
    expect(isGoogleCalendarAvailable()).toBe(true);
  });
});
