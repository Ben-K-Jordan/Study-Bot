/**
 * Settings as a student uses it: saving the profile time zone and study
 * preferences (with the Saving… and Settings saved states), "Use this
 * device's time zone", the theme, Google Calendar in fake mode and the
 * connect result banners, Export data, and Delete account.
 *
 * Tests that save or delete use the `account` fixture (a real account of
 * their own); the theme and the banners only need a fresh test identity.
 * The rules and routes are covered by the unit tests (settings-route,
 * settings-schema, account-delete-route, account-export-route and the
 * google-* route tests); these check the screen and what it saved.
 */
import { readFile } from "node:fs/promises";
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, DETAILS_DONT_MATCH, loggedStatus, openSettings, signInWith } from "./fixtures";

async function savedSettings(api: APIRequestContext) {
  const response = await api.get("/api/settings");
  expect(response.status()).toBe(200);
  return response.json();
}

/**
 * Pick an option from one of the Settings selects with the keyboard: open
 * it, type the start of the option (the list's typeahead moves to it) and
 * press Enter. The time zone list has hundreds of options, and clicking one
 * deep in the list races the list's own scrolling.
 */
async function choose(page: Page, select: string, option: string): Promise<void> {
  const trigger = page.getByRole("combobox", { name: select });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  await page.keyboard.type(option);
  await expect(listbox.getByRole("option", { name: option, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(listbox).toBeHidden();
  await expect(trigger).toContainText(option);
}

test.describe("profile and study preferences", () => {
  test("Save settings shows Saving… then Settings saved, and the time zone stays after a reload", { tag: "@mobile" }, async ({ account }) => {
    const page = account.page;
    await openSettings(page);
    const zone = page.getByRole("combobox", { name: "Time zone" });
    await expect(zone).toHaveText("Choose a time zone");
    await expect(page.getByText("Not set, so days follow UTC.")).toBeVisible();

    await choose(page, "Time zone", "Chicago");
    await expect(zone).toHaveText("Chicago (Central Time)");
    await expect(page.getByText(/^Now in this time zone: /)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();

    await test.step("Saving… while the request is out", async () => {
      // Hold the real request (its response is the server's) so the
      // in-progress state is on screen long enough to check.
      let release = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/settings", async (route) => {
        if (route.request().method() === "PUT") await held;
        await route.continue();
      });

      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
      await expect(page.getByRole("status").filter({ hasText: "Saving…" })).toBeVisible();
      await expect(zone).toBeDisabled();

      release();
      await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Save settings" })).toBeEnabled();
      await page.unrouteAll({ behavior: "wait" });
    });

    await test.step("saved on the server and shown after a reload", async () => {
      expect(await savedSettings(account.api)).toMatchObject({ timezone: "America/Chicago" });
      await page.reload();
      await expect(zone).toHaveText("Chicago (Central Time)");
    });
  });

  test.describe("on a device in Tokyo", () => {
    test.use({ timezoneId: "Asia/Tokyo" });

    test("Use this device's time zone picks the device's zone", async ({ account }) => {
      const page = account.page;
      await openSettings(page);
      const zone = page.getByRole("combobox", { name: "Time zone" });
      const useDevice = page.getByRole("button", { name: "Use this device's time zone" });

      await useDevice.click();
      await expect(zone).toHaveText("Tokyo (Japan Standard Time)");
      await expect(page.getByText("Matches this device")).toBeVisible();
      await expect(useDevice).toHaveCount(0);

      await page.getByRole("button", { name: "Save settings" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();
      expect(await savedSettings(account.api)).toMatchObject({ timezone: "Asia/Tokyo" });
    });
  });

  test("study preferences stay saved after a reload", { tag: "@mobile" }, async ({ account }) => {
    const page = account.page;
    await openSettings(page);
    const start = page.getByRole("textbox", { name: "Daily start time" });
    const end = page.getByRole("textbox", { name: "Daily end time" });
    const limit = page.getByRole("combobox", { name: "Daily study limit" });
    const xpGoal = page.getByRole("combobox", { name: "Daily XP goal" });
    await expect(start).toHaveValue("09:00");
    await expect(limit).toHaveText("3 hr");

    await start.fill("08:30");
    await end.fill("20:00");
    await choose(page, "Daily study limit", "2 hr");
    await choose(page, "Daily XP goal", "100 XP");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved" })).toBeVisible();

    expect(await savedSettings(account.api)).toMatchObject({
      studyStart: "08:30",
      studyEnd: "20:00",
      dailyCap: 120,
      dailyXpGoal: 100,
    });
    await page.reload();
    await expect(start).toHaveValue("08:30");
    await expect(end).toHaveValue("20:00");
    await expect(limit).toHaveText("2 hr");
    await expect(xpGoal).toHaveText("100 XP");
  });

  test("an end time before the start time is caught before saving, and Discard changes restores the form", async ({ account }) => {
    const page = account.page;
    await openSettings(page);
    const end = page.getByRole("textbox", { name: "Daily end time" });
    await end.fill("08:00");
    await page.getByRole("button", { name: "Save settings" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "Settings not saved. Check the highlighted fields." })).toBeVisible();
    await expect(end).toHaveAttribute("aria-invalid", "true");
    await expect(end).toHaveAccessibleDescription("Choose an end time after the start time.");
    await expect(end).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: "Unsaved changes" })).toBeVisible();
    expect(await savedSettings(account.api)).toMatchObject({ studyStart: "09:00", studyEnd: "17:00" });

    await page.getByRole("button", { name: "Discard changes" }).click();
    await expect(end).toHaveValue("17:00");
    await expect(end).not.toHaveAttribute("aria-invalid");
    await expect(page.getByRole("alert").filter({ hasText: "Settings not saved" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Discard changes" })).toHaveCount(0);
  });
});

test.describe("appearance", () => {
  test("Light, Dark and System change the page's theme and stay after a reload", { tag: "@mobile" }, async ({ testUserPage: page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openSettings(page);
    const theme = page.getByRole("radiogroup", { name: "Theme" });
    const html = page.locator("html");
    await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
    await expect(html).toHaveClass(/\blight\b/);

    await test.step("Dark, kept after a reload", async () => {
      await theme.getByRole("radio", { name: "Dark" }).click();
      await expect(html).toHaveClass(/\bdark\b/);
      await page.reload();
      await expect(theme.getByRole("radio", { name: "Dark" })).toBeChecked();
      await expect(html).toHaveClass(/\bdark\b/);
    });

    await test.step("Light", async () => {
      await theme.getByRole("radio", { name: "Light" }).click();
      await expect(html).toHaveClass(/\blight\b/);
      await expect(html).not.toHaveClass(/\bdark\b/);
    });

    await test.step("System follows the device", async () => {
      await theme.getByRole("radio", { name: "System" }).click();
      await page.emulateMedia({ colorScheme: "dark" });
      await expect(html).toHaveClass(/\bdark\b/);
      await page.emulateMedia({ colorScheme: "light" });
      await expect(html).toHaveClass(/\blight\b/);
      await page.reload();
      await expect(theme.getByRole("radio", { name: "System" })).toBeChecked();
    });
  });
});

test.describe("Google Calendar", () => {
  test("Connect Google Calendar in fake mode connects, and Disconnect asks first", async ({ account, request }) => {
    const config = await (await request.get("/api/config")).json();
    test.skip(!config.google_configured, "Settings shows Google Calendar only when the server has GOOGLE_CLIENT_ID.");
    const page = account.page;
    await openSettings(page);
    const section = page.getByRole("region", { name: "Google Calendar" });
    await expect(section).toContainText("Not connected");

    await test.step("Connect lands back on Settings with a banner", async () => {
      // With GOOGLE_PROVIDER=fake the connect route connects the fake
      // calendar itself and redirects where Google's callback would.
      await section.getByRole("link", { name: "Connect Google Calendar" }).click();
      const banner = page.getByRole("status").filter({ hasText: "Google Calendar connected" });
      await expect(banner).toContainText("Add a plan's sessions to it from the Plan page.");
      await expect(banner.getByText("Google Calendar connected", { exact: true })).toBeFocused();
      await expect(page).toHaveURL("/settings");
    });

    await test.step("the section shows the account and its calendars", async () => {
      await expect(section).toContainText("test@example.com");
      await expect(section.getByText("Connected", { exact: true })).toBeVisible();
      await expect(section.getByRole("combobox", { name: "Calendar for sessions" })).toHaveText("Primary (primary)");
      const busy = section.getByRole("checkbox", { name: "Primary (primary)" });
      await expect(busy).toBeChecked();
      // The last busy calendar can't be unchecked.
      await expect(busy).toBeDisabled();
      expect(await (await account.api.get("/api/integrations/google/status")).json()).toMatchObject({ connected: true });
    });

    await test.step("Disconnect asks first, then offers Connect again", async () => {
      await section.getByRole("button", { name: "Disconnect" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Disconnect Google Calendar?" });
      await expect(dialog).toContainText("Events already in Google Calendar stay there.");
      await dialog.getByRole("button", { name: "Disconnect Google Calendar" }).click();
      await expect(dialog).toBeHidden();
      await expect(section.getByRole("status").filter({ hasText: "Google Calendar disconnected" })).toBeVisible();
      await expect(section.getByRole("link", { name: "Connect Google Calendar" })).toBeVisible();
      expect(await (await account.api.get("/api/integrations/google/status")).json()).toMatchObject({ connected: false });
    });
  });

  test("after Disconnect, focus moves to Connect Google Calendar", async ({ account, request }) => {
    const config = await (await request.get("/api/config")).json();
    test.skip(!config.google_configured, "Settings shows Google Calendar only when the server has GOOGLE_CLIENT_ID.");
    const seeded = await account.api.post("/api/integrations/google/test-seed", { data: { connected_email: account.email } });
    expect(seeded.status()).toBe(200);
    const page = account.page;
    await openSettings(page, "/settings#calendar");
    const section = page.getByRole("region", { name: "Google Calendar" });

    await section.getByRole("button", { name: "Disconnect" }).click();
    await page.getByRole("alertdialog", { name: "Disconnect Google Calendar?" }).getByRole("button", { name: "Disconnect Google Calendar" }).click();
    await expect(section.getByRole("status").filter({ hasText: "Google Calendar disconnected" })).toBeVisible();
    await expect(section.getByRole("link", { name: "Connect Google Calendar" })).toBeFocused();
  });

  test("the result of connecting shows as a banner, and Dismiss hands focus to the page", async ({ testUserPage: page }) => {
    await test.step("connected", async () => {
      await page.goto("/settings?google=connected");
      const banner = page.getByRole("status").filter({ hasText: "Google Calendar connected" });
      await expect(banner).toContainText("Add a plan's sessions to it from the Plan page.");
      await expect(banner.getByText("Google Calendar connected", { exact: true })).toBeFocused();
      // The query goes, so a reload doesn't repeat the banner.
      await expect(page).toHaveURL("/settings");
      await banner.getByRole("button", { name: "Dismiss" }).click();
      await expect(banner).toHaveCount(0);
      await expect(page.getByRole("main")).toBeFocused();
    });

    for (const [reason, description] of [
      ["access_denied", "Study Bot needs your permission to add sessions to your calendar. Connect again and allow access on Google's page."],
      ["invalid_state", "The connection request expired. Connect again."],
      ["no_refresh_token", "Google didn't grant lasting access."],
      ["something_unexpected", "The connection didn't finish. Connect again in a minute."],
    ]) {
      await test.step(`error: ${reason}`, async () => {
        await page.goto(`/settings?google=error&reason=${reason}`);
        const banner = page.getByRole("alert").filter({ hasText: "Google Calendar not connected" });
        await expect(banner).toContainText(description);
        await expect(banner).not.toContainText(reason);
        await expect(page).toHaveURL("/settings");
      });
    }
  });
});

test.describe("data and account", () => {
  test("Export data downloads a JSON file of the account", async ({ account }) => {
    const saved = await account.api.put("/api/settings", { data: { dailyXpGoal: 100 } });
    expect(saved.status()).toBe(200);
    const page = account.page;
    await openSettings(page);

    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export data (.json)" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^study-bot-export-\d+\.json$/);
    await expect(page.getByRole("status").filter({ hasText: "Data exported. Check your downloads." })).toBeVisible();

    const data = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(data.user).toMatchObject({ email: account.email, name: "E2E Account" });
    expect(data.user).not.toHaveProperty("passwordHash");
    expect(data.userGameState).toMatchObject({ dailyXpGoal: 100 });
  });

  test.describe(() => {
    // A wrong password answers 403, and signing in to the deleted account 401.
    test.use({ allowConsoleErrors: [loggedStatus(401, 403)] });

    test("Delete account needs the password, then lands on sign in and the account is gone", { tag: "@mobile" }, async ({ account }) => {
      // Each password check takes the server about 2 s (bcrypt at cost 12), and this test makes several.
      test.slow();
      const page = account.page;

      await test.step("the API also needs the confirmation phrase", async () => {
        const response = await account.api.delete("/api/account/delete", { data: { password: account.password } });
        expect(response.status()).toBe(400);
        expect((await account.api.get("/api/settings")).status()).toBe(200);
      });

      await openSettings(page, "/settings#account");
      await page.getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("alertdialog", { name: "Delete your account?" });
      await expect(dialog).toContainText(
        "This permanently deletes your plans, sessions, answers, materials, decks, guides, and chat history",
      );
      const password = dialog.getByLabel("Enter your password to confirm");
      const confirm = dialog.getByRole("button", { name: "Delete account" });

      await test.step("nothing happens without the right password", async () => {
        await expect(password).toBeFocused();
        await expect(confirm).toBeDisabled();
        await password.fill("not-the-password");
        await confirm.click();
        await expect(password).toHaveAccessibleDescription("That password doesn't match your account. Check it and retry.");
        await expect(password).toHaveAttribute("aria-invalid", "true");
        await expect(dialog).toBeVisible();
        expect((await account.api.get("/api/settings")).status()).toBe(200);
      });

      await test.step("the right password deletes the account and signs out", async () => {
        await password.fill(account.password);
        await confirm.click();
        await expect(page).toHaveURL("/auth/signin?account=deleted");
        await expect(page.getByRole("status").filter({ hasText: "Account deleted" })).toContainText(
          "Your plans, sessions, materials, and chat history are gone.",
        );
      });

      await test.step("the account can't sign in, and its other sessions end", async () => {
        await expect(page.getByRole("textbox", { name: "Email" })).toBeFocused();
        await signInWith(page, account.email, account.password);
        await expect(page.getByRole("group", { name: DETAILS_DONT_MATCH })).toBeFocused();
        expect((await account.api.get("/api/settings")).status()).toBe(401);
      });
    });
  });
});
