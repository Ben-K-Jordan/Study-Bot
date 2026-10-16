/**
 * Page helpers shared by the specs: waiting for a control to hydrate,
 * menus, toasts, the lesson's tactile radios, and waiting for a screen to
 * settle before axe looks at it.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Wait until React has hydrated `control`. Server-rendered controls show
 * before the page's script runs, and a click or a typed value then never
 * reaches the app's handlers (a menu stays shut, a form submits natively, a
 * typed value is lost). React attaches its props to a DOM node when it
 * hydrates it, which also covers content inside a Suspense boundary that
 * hydrates after the rest of the page.
 */
export async function hydrated(control: Locator): Promise<void> {
  await expect
    .poll(() => control.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$"))))
    .toBe(true);
}

/** Open the menu behind a button once the button has hydrated, and return the menu. */
export async function openMenu(page: Page, triggerName: string): Promise<Locator> {
  const trigger = page.getByRole("button", { name: triggerName });
  await hydrated(trigger);
  await trigger.click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

/** The toast region (Sonner). Toasts last 8 s, so assert on them soon after the action. */
export function toasts(page: Page): Locator {
  return page.getByRole("region", { name: "Notifications alt+T" });
}

/**
 * Pick a choice or a confidence level in the lesson. The radios are visually
 * hidden inside their tactile cards, which take the click.
 */
export async function pick(radio: Locator): Promise<void> {
  await radio.check({ force: true });
}

/**
 * Wait until the page is still: no "Loading…" status left in the main
 * region, and no finite animation running (a dialog or an answer fading in).
 * Mid fade-in, text is partly transparent and axe would measure its contrast
 * against the wrong colour.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.getByRole("main").getByRole("status").filter({ hasText: /^Loading/ })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .getAnimations()
            .filter((a) => a.playState === "running" && a.effect?.getTiming().iterations !== Infinity).length,
      ),
    )
    .toBe(0);
}

/**
 * Open `path`, and open it again until `ready` shows. For data the server
 * writes just after it answers (mastery, XP and the streak land just after
 * a run completes), so the first load can come a moment early.
 */
export async function openWhen(page: Page, path: string, ready: Locator): Promise<void> {
  await expect(async () => {
    await page.goto(path);
    await expect(ready).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
