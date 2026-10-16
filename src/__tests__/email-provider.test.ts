/**
 * Email links without SMTP: the console provider prints reset and
 * verification links only where a developer or the e2e suite reads them,
 * never in a production log, and the public config tells screens whether
 * an email can reach the student at all.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { areEmailLinksAvailable, isEmailDeliveryConfigured, mayPrintEmailLinks } from "@/lib/email/delivery";
import { ConsoleProvider, createEmailProvider } from "@/lib/email/provider";
import { publicConfig } from "@/lib/public-config";

const TOKEN = "raw-reset-token-1234567890";
const RESET_URL = `https://studybot.example/auth/reset-password?token=${TOKEN}`;
const HTML = `<p>Choose a new password.</p><a href="${RESET_URL}">Reset password</a>`;

/** Every line the provider wrote to stdout, joined. */
function printed(spy: MockInstance<typeof console.log>): string {
  return spy.mock.calls.map((args) => args.map(String).join(" ")).join("\n");
}

describe("email links without SMTP", () => {
  let log: MockInstance<typeof console.log>;

  beforeEach(() => {
    vi.stubEnv("EMAIL_PROVIDER", "console");
    vi.stubEnv("ALLOW_TEST_AUTH", "");
    vi.stubEnv("CI", "");
    // The logger is silent under vitest unless a level is set.
    vi.stubEnv("LOG_LEVEL", "info");
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints the full link in development, so the developer can follow it", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await new ConsoleProvider().send("student@example.com", "Reset your Study Bot password", HTML);
    expect(printed(log)).toContain(RESET_URL);
  });

  it("never writes the link or the token to a production log", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await new ConsoleProvider().send("student@example.com", "Reset your Study Bot password", HTML);
    const out = printed(log);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain("reset-password");
    // The operator still learns that an email didn't go out.
    expect(out).toContain("email_not_delivered");
    expect(out).toContain("Reset your Study Bot password");
  });

  it("prints links on the CI e2e server, which already trusts test sign-in", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_TEST_AUTH", "true");
    vi.stubEnv("CI", "true");
    vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
    expect(mayPrintEmailLinks()).toBe(true);
    await new ConsoleProvider().send("student@example.com", "Reset your Study Bot password", HTML);
    expect(printed(log)).toContain(RESET_URL);
  });

  it("warns once at startup when a production server can't send email", () => {
    vi.stubEnv("NODE_ENV", "production");
    createEmailProvider();
    expect(printed(log)).toContain("email.not_configured");

    log.mockClear();
    vi.stubEnv("NODE_ENV", "development");
    createEmailProvider();
    expect(printed(log)).not.toContain("email.not_configured");
  });

  it("offers email links in development and with SMTP, and not on a production server without SMTP", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(areEmailLinksAvailable()).toBe(true);
    expect(publicConfig()).toMatchObject({ email_configured: false, email_links_available: true });

    vi.stubEnv("NODE_ENV", "production");
    expect(isEmailDeliveryConfigured()).toBe(false);
    expect(areEmailLinksAvailable()).toBe(false);
    expect(publicConfig()).toMatchObject({ email_configured: false, email_links_available: false });

    vi.stubEnv("EMAIL_PROVIDER", "smtp");
    expect(areEmailLinksAvailable()).toBe(true);
    expect(publicConfig()).toMatchObject({ email_configured: true, email_links_available: true });
  });
});
