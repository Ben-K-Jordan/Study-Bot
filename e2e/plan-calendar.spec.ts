/**
 * Google Calendar from the plan: Add to Google Calendar, Update Google
 * Calendar, Remove from Google Calendar behind its confirmation (focus goes
 * back to the plan menu), and the alert when Google needs the student to
 * sign in again. The server runs GOOGLE_PROVIDER=fake, so nothing reaches
 * Google, and each test connects its own identity through
 * /api/integrations/google/test-seed.
 *
 * Already covered elsewhere: publish, update and reconcile rules in
 * src/__tests__/integration/google-calendar.test.ts, and Connect and
 * Disconnect in settings.spec.ts.
 */
import type { APIRequestContext } from "@playwright/test";
import { test, expect, createPlan, expectNoAxeViolations, hydrated, toasts, unique, type CreatedPlan } from "./fixtures";

const EXAM = "Prelim 1";

interface Publication {
  publication: { status: string } | null;
  items: { plan_item_id: string }[];
}

/** Connect Google Calendar for this identity, or mark the connection as needing a new sign-in ("ERROR"). */
async function seedGoogle(api: APIRequestContext, status: "CONNECTED" | "ERROR" = "CONNECTED"): Promise<void> {
  const response = await api.post("/api/integrations/google/test-seed", { data: { status } });
  expect(response.status(), "the server needs GOOGLE_PROVIDER=fake and test auth").toBe(200);
}

async function publication(api: APIRequestContext, planId: string): Promise<Publication> {
  const response = await api.get(`/api/plans/${planId}/publish/google`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function seedPlan(api: APIRequestContext, label: string): Promise<CreatedPlan> {
  return createPlan(api, { course_name: unique(label), exam_name: EXAM });
}

test.beforeEach(async ({ testUser }) => {
  const config = await (await testUser.api.get("/api/config")).json();
  test.skip(!config.google_configured, "The plan shows Google Calendar only when the server can connect it (GOOGLE_PROVIDER=fake here).");
});

test("Add to Google Calendar adds every session, and Update keeps them there", async ({
  testUserPage: page,
  testUser,
}) => {
  await seedGoogle(testUser.api);
  const plan = await seedPlan(testUser.api, "E2E Calendar add");
  expect((await publication(testUser.api, plan.id)).publication).toBeNull();

  await page.goto(`/plan?plan=${plan.id}`);
  const add = page.getByRole("button", { name: "Add to Google Calendar" });
  await hydrated(add);
  await add.click();

  await expect(toasts(page)).toContainText("Added to Google Calendar");
  await expect(page.getByText("In Google Calendar", { exact: true })).toBeVisible();
  await expect(add).toBeHidden();
  const added = await publication(testUser.api, plan.id);
  expect(added.publication?.status).toBe("PUBLISHED");
  expect(added.items).toHaveLength(plan.items.length);

  await test.step("Update Google Calendar from the plan menu", async () => {
    await page.getByRole("button", { name: `More actions for the ${EXAM} plan` }).click();
    const update = page.waitForResponse(
      (response) => response.request().method() === "POST" && response.url().endsWith(`/api/plans/${plan.id}/publish/google`),
    );
    await page.getByRole("menuitem", { name: "Update Google Calendar" }).click();
    expect((await update).status()).toBe(200);
    await expect(page.getByText("In Google Calendar", { exact: true })).toBeVisible();
    const updated = await publication(testUser.api, plan.id);
    expect(updated.publication?.status).toBe("PUBLISHED");
    expect(updated.items).toHaveLength(plan.items.length);
  });
});

test("Remove from Google Calendar asks first, then takes the events out", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  await seedGoogle(testUser.api);
  const plan = await seedPlan(testUser.api, "E2E Calendar remove");
  const published = await testUser.api.post(`/api/plans/${plan.id}/publish/google`, { data: {} });
  expect(published.status(), await published.text()).toBe(200);

  await page.goto(`/plan?plan=${plan.id}`);
  const more = page.getByRole("button", { name: `More actions for the ${EXAM} plan` });
  const dialog = page.getByRole("alertdialog", {
    name: `Remove the ${plan.course} ${EXAM} sessions from Google Calendar?`,
  });
  const openRemove = async () => {
    await more.click();
    await page.getByRole("menuitem", { name: "Remove from Google Calendar" }).click();
  };
  await hydrated(more);

  await test.step("Cancel keeps the events", async () => {
    await openRemove();
    await expect(dialog).toContainText(
      `This removes the plan's ${plan.items.length} events from Google Calendar. The plan and its sessions stay here.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    // The menu item is gone with the menu, so focus goes back to the menu button
    await expect(more).toBeFocused();
    expect((await publication(testUser.api, plan.id)).items).toHaveLength(plan.items.length);
  });

  await openRemove();
  await dialog.getByRole("button", { name: "Remove events" }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page)).toContainText("Removed from Google Calendar");
  await expect(more).toBeFocused();
  await expect(page.getByRole("button", { name: "Add to Google Calendar" })).toBeVisible();
  await expect(page.getByText("In Google Calendar", { exact: true })).toHaveCount(0);

  const removed = await publication(testUser.api, plan.id);
  expect(removed.publication?.status).toBe("UNPUBLISHED");
  expect(removed.items).toEqual([]);
});

test("a plan in Google Calendar asks to reconnect when the sign-in expired", { tag: "@a11y" }, async ({
  testUserPage: page,
  testUser,
}) => {
  await seedGoogle(testUser.api);
  const plan = await seedPlan(testUser.api, "E2E Calendar reconnect");
  const published = await testUser.api.post(`/api/plans/${plan.id}/publish/google`, { data: {} });
  expect(published.status(), await published.text()).toBe(200);
  await seedGoogle(testUser.api, "ERROR");

  await page.goto(`/plan?plan=${plan.id}`);
  // A notice that is there on arrival, so it isn't announced as an alert
  const notice = page
    .getByRole("main")
    .locator('[data-slot="alert"]')
    .filter({ hasText: "Google Calendar needs you to sign in again." });
  await expect(notice).toContainText("Until then, changes to this plan don't reach Google Calendar.");
  await expect(notice.getByRole("link", { name: "Reconnect Google Calendar" })).toHaveAttribute(
    "href",
    "/settings#calendar",
  );
  // Nothing to add while the events are still there
  await expect(page.getByRole("button", { name: "Add to Google Calendar" })).toHaveCount(0);

  const more = page.getByRole("button", { name: `More actions for the ${EXAM} plan` });
  await hydrated(more);
  await more.click();
  await expect(page.getByRole("menuitem", { name: "Update Google Calendar" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: "Remove from Google Calendar" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();

  await expectNoAxeViolations(page, "the plan with a Google Calendar sign-in to renew");
});
