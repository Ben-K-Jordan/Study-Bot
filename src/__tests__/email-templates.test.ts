/**
 * Account emails: copy per VOICE.md, escaping, and no dead settings links.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { emailVerification, passwordReset } from "@/lib/email/templates";

function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("account email templates", () => {
  beforeEach(() => {
    vi.stubEnv("BASE_URL", "https://studybot.example");
  });

  const emails = [
    emailVerification("Ben", "https://studybot.example/api/auth/verify-email?token=abc"),
    passwordReset("Ben", "https://studybot.example/auth/reset-password?token=xyz"),
  ];

  it("keeps the subjects", () => {
    expect(emails[0].subject).toBe("Verify your Study Bot account");
    expect(emails[1].subject).toBe("Reset your Study Bot password");
  });

  it("states the link expiry and carries the link twice (button and fallback)", () => {
    expect(visibleText(emails[0].html)).toContain("This link expires in 24 hours.");
    expect(visibleText(emails[1].html)).toContain("This link expires in 1 hour.");
    expect(emails[0].html.match(/verify-email\?token=abc/g)).toHaveLength(3);
    expect(emails[1].html.match(/reset-password\?token=xyz/g)).toHaveLength(3);
  });

  it("drops the jokes, the notification footer, dashes, exclamation marks and 'we'", () => {
    for (const { html } of emails) {
      const text = visibleText(html);
      expect(html).not.toContain("#notifications");
      expect(text).not.toMatch(/reminders|unsubscribe/i);
      expect(text).not.toMatch(/[–—!]/);
      expect(text).not.toMatch(/\b(we|we're|we've|our)\b/i);
      expect(text).not.toMatch(/journey|robot|hopefully/i);
    }
  });

  it("uses the new palette, not the chalkboard one", () => {
    for (const { html } of emails) {
      expect(html).toContain("#0B57D0");
      expect(html).not.toMatch(/#2a3d2a|#f0dc4e/i);
    }
  });

  it("escapes the name and falls back when it is blank", () => {
    const { html } = emailVerification("<b>Ben</b>", "https://x.test/v");
    expect(html).toContain("Hi &lt;b&gt;Ben&lt;/b&gt;,");
    expect(visibleText(emailVerification("  ", "https://x.test/v").html)).toContain("Hi,");
  });
});
