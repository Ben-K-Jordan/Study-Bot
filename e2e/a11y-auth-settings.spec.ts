/**
 * Accessibility of the auth screens and Settings. axe (WCAG 2.0, 2.1 and
 * 2.2 at A and AA) runs in the light and dark themes, on desktop and on the
 * phone layout, over each screen's main states: empty, with field errors, a
 * link that doesn't work, a sent link, and the Delete account dialog. Then
 * the keyboard paths axe can't check: signing in without a mouse, and focus
 * going back to Delete account when its dialog closes with Escape.
 */
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  NEEDS_DATABASE,
  SIGNED_OUT,
  expectNoAxeViolations,
  hasDatabase,
  insertToken,
  newEmail,
  openSettings,
  openSignIn,
} from "./fixtures";

const SCHEMES = ["light", "dark"] as const;

/** The theme follows the emulated system setting; check it took before axe looks. */
async function expectScheme(page: Page, scheme: (typeof SCHEMES)[number]): Promise<void> {
  await expect(page.locator("html")).toHaveClass(new RegExp(`\\b${scheme}\\b`));
}

for (const scheme of SCHEMES) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test.describe("auth screens", () => {
      test.use({ storageState: SIGNED_OUT });

      for (const { path, heading } of [
        { path: "/auth/signin", heading: "Sign in" },
        { path: "/auth/signup", heading: "Create account" },
        { path: "/auth/forgot-password", heading: "Reset password" },
        { path: "/auth/reset-password?token=not-a-real-token", heading: "This reset link doesn't work" },
        { path: "/auth/verify-email?email=ada%40studybot.test", heading: "Verify your email" },
        { path: "/auth/verify-email?status=invalid", heading: "This verification link doesn't work" },
      ]) {
        test(`${heading} (${path}) passes axe`, { tag: ["@a11y", "@mobile"] }, async ({ page }) => {
          await page.goto(path);
          await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
          // WCAG 2.4.2: the title names this screen, a broken link included.
          await expect(page).toHaveTitle(`${heading} · Study Bot`);
          await expectScheme(page, scheme);
          await expectNoAxeViolations(page, `${heading} (${scheme})`);
        });
      }

      test("the forms with their errors and the sent screen pass axe", { tag: ["@a11y", "@mobile"] }, async ({ page }) => {
        await test.step("Create account, every field in error", async () => {
          await page.goto("/auth/signup");
          await expect(page.getByRole("textbox", { name: "Name" })).toBeFocused();
          await page.getByRole("button", { name: "Create account" }).click();
          await expect(page.getByRole("group", { name: "Fix 4 fields to continue" })).toBeFocused();
          await expectScheme(page, scheme);
          await expectNoAxeViolations(page, "Create account with every field in error");
        });

        await test.step("Sign in, both fields in error", async () => {
          await openSignIn(page);
          await page.getByRole("button", { name: "Sign in" }).click();
          await expect(page.getByRole("group", { name: "Fix 2 fields to continue" })).toBeFocused();
          await expectNoAxeViolations(page, "Sign in with both fields in error");
        });

        await test.step("Reset password, then Check your email", async () => {
          await page.goto("/auth/forgot-password");
          const email = page.getByRole("textbox", { name: "Email" });
          await expect(email).toBeFocused();
          await page.getByRole("button", { name: "Send reset link" }).click();
          await expect(email).toHaveAccessibleDescription("Enter your email address.");
          await expectNoAxeViolations(page, "Reset password with its field in error");

          // Reset links are limited per address (5 an hour), so each run asks for a new one.
          await email.fill(newEmail());
          await page.getByRole("button", { name: "Send reset link" }).click();
          await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeFocused();
          await expectNoAxeViolations(page, "Check your email");
        });
      });

      test("Choose a new password, from a working reset link, passes axe", { tag: ["@a11y", "@mobile"] }, async ({ page, account }) => {
        test.skip(!hasDatabase, NEEDS_DATABASE);
        const token = await insertToken(account.email, "PASSWORD_RESET");
        await page.goto(`/auth/reset-password?token=${token}`);
        await expect(page.getByRole("heading", { level: 1, name: "Choose a new password" })).toBeVisible();
        await expect(page.getByRole("textbox", { name: "New password", exact: true })).toBeFocused();
        await expectScheme(page, scheme);
        await expectNoAxeViolations(page, "Choose a new password");
      });
    });

    test.describe("Settings", () => {
      test("Settings passes axe", { tag: ["@a11y", "@mobile"] }, async ({ account }) => {
        const page = account.page;
        await openSettings(page);
        await expectScheme(page, scheme);
        await expectNoAxeViolations(page, "Settings");
      });

      test("Settings with a field error and a Google Calendar banner passes axe", { tag: ["@a11y", "@mobile"] }, async ({ account }) => {
        const page = account.page;
        await openSettings(page, "/settings?google=error&reason=access_denied");
        await expect(page.getByRole("alert").filter({ hasText: "Google Calendar not connected" })).toBeVisible();
        await page.getByRole("textbox", { name: "Daily end time" }).fill("08:00");
        await page.getByRole("button", { name: "Save settings" }).click();
        await expect(page.getByRole("textbox", { name: "Daily end time" })).toHaveAccessibleDescription(
          "Choose an end time after the start time.",
        );
        await expectScheme(page, scheme);
        await expectNoAxeViolations(page, "Settings with a field error and a banner");
      });

      test("the Delete account dialog passes axe", { tag: ["@a11y", "@mobile"] }, async ({ account }) => {
        const page = account.page;
        await openSettings(page, "/settings#account");
        await page.getByRole("button", { name: "Delete account" }).click();
        const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
        await expect(dialog.getByLabel("Enter your password to confirm")).toBeFocused();
        await expectScheme(page, scheme);
        await expectNoAxeViolations(page, "the Delete account dialog");
      });
    });
  });
}

test.describe("keyboard", () => {
  test.describe(() => {
    test.use({ storageState: SIGNED_OUT });

    test("a student can sign in with the keyboard alone", { tag: "@a11y" }, async ({ page, account }) => {
      await openSignIn(page);
      const password = page.getByLabel("Password", { exact: true });

      await page.keyboard.type(account.email);
      await page.keyboard.press("Tab");
      await expect(password).toBeFocused();
      await page.keyboard.type(account.password);

      await page.keyboard.press("Tab");
      const show = page.getByRole("checkbox", { name: "Show password" });
      await expect(show).toBeFocused();
      await page.keyboard.press("Space");
      await expect(show).toBeChecked();
      await expect(password).toHaveAttribute("type", "text");

      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Forgot password?" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("link", { name: "Create account" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL("/");
      await expect(page.getByRole("heading", { level: 1, name: "Home" })).toBeVisible();
    });
  });

  test("Escape closes the Delete account dialog and focus goes back to its button", { tag: "@a11y" }, async ({ account }) => {
    const page = account.page;
    await openSettings(page, "/settings#account");
    const trigger = page.getByRole("button", { name: "Delete account" });
    const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
    const password = dialog.getByLabel("Enter your password to confirm");

    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(password).toBeFocused();
    await page.keyboard.type("half-typed");

    await test.step("Tab stays inside the dialog", async () => {
      // Delete account is disabled until a password is typed, so with one
      // typed the order is the field, the reset link in its hint, Cancel,
      // Delete account, then the field.
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("link", { name: "Reset your password" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Delete account" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(password).toBeFocused();
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await test.step("reopened, the dialog starts empty", async () => {
      await page.keyboard.press("Enter");
      await expect(password).toBeFocused();
      await expect(password).toHaveValue("");
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
    });
  });
});
