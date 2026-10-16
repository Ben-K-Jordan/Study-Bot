/**
 * Helpers for the auth screens and Settings: opening them once their forms
 * have hydrated, signing in through the form, and the copy several specs
 * assert.
 */
import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

/** Copy the sign-in page shows for a wrong email or password. */
export const DETAILS_DONT_MATCH =
  "That email and password don't match an account. Check both, or reset your password.";

/** A unique address for an account a test creates through the UI. */
export function newEmail(): string {
  return `e2e-${randomBytes(5).toString("hex")}@studybot.test`;
}

/**
 * Open the sign-in page. The Email field takes focus when the form has
 * hydrated (autoFocus runs in the browser), which is also the cue that
 * typing and submitting reach the form's own handlers.
 */
export async function openSignIn(page: Page, path = "/auth/signin"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
}

/** Fill the sign-in form and submit it. */
export async function signInWith(page: Page, email: string, password: string): Promise<void> {
  await page.getByRole("textbox", { name: "Email" }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/**
 * Open Settings and wait for the form to hydrate. The time zone field
 * learns the device's zone in the browser, so its "Use this device's time
 * zone" button (or "Matches this device") is the cue that the form's own
 * handlers are live.
 */
export async function openSettings(page: Page, path = "/settings"): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Use this device's time zone" }).or(page.getByText("Matches this device")),
  ).toBeVisible();
}
