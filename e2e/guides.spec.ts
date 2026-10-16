/**
 * Study guides (/guides): Generate guide with the mock AI, the three format
 * tabs (keyboard included) with their sections rendered as headings and
 * text, the ?format= deep link, Export guide (.md), Delete guide with its
 * confirmation, and the course it opens on when none is chosen. Each test
 * seeds its own identity, which also gives it its own AI rate limit (5 a
 * minute).
 *
 * Already covered elsewhere: section cleanup, Markdown export and file
 * names in src/__tests__/guide-format.test.ts, and listing in
 * study-guides-list.test.ts. The mock AI's guides hold plain text only, so
 * Markdown lists and tables inside a section can't be reached here.
 */
import { readFile } from "node:fs/promises";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, createGuide, createPlan, toasts, unique, uploadMaterial } from "./fixtures";

const NOTES = "Recursion: a function that calls itself on a smaller input until it reaches a base case.";

async function listGuides(api: APIRequestContext, course: string): Promise<{ id: string; guide_type: string }[]> {
  const response = await api.get(`/api/guides?course_name=${encodeURIComponent(course)}`);
  expect(response.status()).toBe(200);
  return (await response.json()).guides;
}

test("Generate guide writes a key concepts guide from the course's materials", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Guides");
  await uploadMaterial(testUser.api, { course, text: NOTES });

  await page.goto("/guides");
  await expect(page.getByRole("tab", { name: "Key concepts" })).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: "Key concepts" });
  await expect(panel.getByRole("heading", { level: 2, name: `No key concepts guide for ${course} yet` })).toBeVisible();

  await panel.getByRole("button", { name: "Generate guide" }).click();
  const article = panel.getByRole("article", { name: `Key concepts for ${course}` });
  // The new guide takes focus at its title.
  await expect(article.getByRole("heading", { level: 2 })).toBeFocused();
  await expect(article).toContainText("AI-written");
  await expect(article).toContainText(`Written by AI from your ${course} materials. Check it against your files.`);
  await expect(article.getByRole("heading", { level: 3 })).toHaveText(["Core principles", "Applied methods"]);
  await expect(article.getByText("Why it matters: Every later topic assumes them.")).toBeVisible();
  await expect(page).toHaveURL(/\/guides\?format=key-concepts&guide=[\w-]+$/);
  expect((await listGuides(testUser.api, course)).map((g) => g.guide_type)).toEqual(["KEY_CONCEPTS"]);
});

test("each format has its own tab, reachable with the arrow keys and by link", async ({
  testUserPage: page,
  testUser,
}) => {
  test.slow();
  const course = unique("E2E Formats");
  await uploadMaterial(testUser.api, { course, text: NOTES });
  await page.goto("/guides");
  const tabs = page.getByRole("tablist", { name: "Guide format" });
  await expect(tabs.getByRole("tab")).toHaveText(["Key concepts", "FAQ", "Cheat sheet"]);

  await test.step("FAQ", async () => {
    await tabs.getByRole("tab", { name: "Key concepts" }).press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "FAQ" })).toBeFocused();
    await expect(tabs.getByRole("tab", { name: "FAQ" })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: "FAQ" });
    await expect(panel.getByRole("heading", { level: 2, name: `No FAQ for ${course} yet` })).toBeVisible();
    await panel.getByRole("button", { name: "Generate guide" }).click();
    const article = panel.getByRole("article", { name: `FAQ for ${course}` });
    await expect(article.getByRole("heading", { level: 3 })).toHaveText([
      "What are the core concepts?",
      "How are these concepts applied?",
    ]);
  });

  await test.step("Cheat sheet", async () => {
    await tabs.getByRole("tab", { name: "FAQ" }).press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Cheat sheet" })).toHaveAttribute("aria-selected", "true");
    const panel = page.getByRole("tabpanel", { name: "Cheat sheet" });
    await panel.getByRole("button", { name: "Generate guide" }).click();
    const article = panel.getByRole("article", { name: `Cheat sheet for ${course}` });
    await expect(article.getByRole("heading", { level: 3 })).toHaveText(["Key definitions", "Formulas"]);
    await expect(article.getByText("Term 1: Definition of the first key concept")).toBeVisible();
    await expect(article.getByText("Formula 2: X = Y * Z")).toBeVisible();
  });

  await test.step("the link opens the same tab and guide", async () => {
    await expect(page).toHaveURL(/\?format=cheat-sheet&guide=[\w-]+$/);
    await page.reload();
    await expect(tabs.getByRole("tab", { name: "Cheat sheet" })).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tabpanel", { name: "Cheat sheet" }).getByRole("heading", { level: 2, name: `Cheat sheet for ${course}` }),
    ).toBeVisible();
  });
  expect((await listGuides(testUser.api, course)).map((g) => g.guide_type).sort()).toEqual(["CHEAT_SHEET", "FAQ"]);
});

test("Export guide (.md) downloads the guide as Markdown", async ({ testUserPage: page, testUser }) => {
  const course = unique("E2E Export guide");
  await uploadMaterial(testUser.api, { course, text: NOTES });
  await createGuide(testUser.api, course, "KEY_CONCEPTS");

  await page.goto("/guides");
  const article = page.getByRole("article", { name: `Key concepts for ${course}` });
  const download = page.waitForEvent("download");
  await article.getByRole("button", { name: "Export guide (.md)" }).click();
  const file = await download;
  const slug = `key concepts for ${course}`.toLowerCase().replace(/\s+/g, "-");
  expect(file.suggestedFilename()).toBe(`${slug}.md`);

  const markdown = await readFile(await file.path(), "utf8");
  expect(markdown.startsWith(`# Key concepts for ${course}\n`)).toBe(true);
  expect(markdown).toContain("## Core principles\nThe ideas the rest of the course material builds on.");
  expect(markdown).toContain("_Why it matters: Every later topic assumes them._");
  expect(markdown).toContain("\n---\n\n## Applied methods");
});

test("Delete guide asks first and removes the guide", { tag: "@mobile" }, async ({ testUserPage: page, testUser }) => {
  const course = unique("E2E Delete guide");
  await uploadMaterial(testUser.api, { course, text: NOTES });
  await createGuide(testUser.api, course, "KEY_CONCEPTS");

  await page.goto("/guides");
  const panel = page.getByRole("tabpanel", { name: "Key concepts" });
  const remove = panel.getByRole("button", { name: "Delete guide" });
  const dialog = page.getByRole("alertdialog", { name: `Delete Key concepts for ${course}?` });

  await test.step("Cancel keeps it", async () => {
    await remove.click();
    await expect(dialog).toContainText("This deletes the guide and its 2 sections. Your materials and other guides stay.");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    expect(await listGuides(testUser.api, course)).toHaveLength(1);
  });

  await remove.click();
  await dialog.getByRole("button", { name: "Delete guide" }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page)).toContainText("Guide deleted");
  await expect(panel.getByRole("heading", { level: 2, name: `No key concepts guide for ${course} yet` })).toBeVisible();
  // The opener left with the guide, so focus lands on the panel.
  await expect(panel).toBeFocused();
  await expect(page).not.toHaveURL(/guide=/);
  expect(await listGuides(testUser.api, course)).toEqual([]);
});

test("Cancel or Escape on Delete guide returns focus to the Delete guide button", async ({ testUserPage: page, testUser }) => {
  const course = unique("E2E Guide focus");
  await uploadMaterial(testUser.api, { course, text: NOTES });
  await createGuide(testUser.api, course, "KEY_CONCEPTS");

  await page.goto("/guides");
  const remove = page.getByRole("tabpanel", { name: "Key concepts" }).getByRole("button", { name: "Delete guide" });
  const dialog = page.getByRole("alertdialog", { name: `Delete Key concepts for ${course}?` });
  await remove.click();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await remove.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
});

test("with no course chosen, Study guides open on the course with the nearest exam, not the latest upload", async ({
  testUserPage: page,
  testUser,
}) => {
  const examCourse = unique("E2E Exam soon");
  const latestCourse = unique("E2E Latest upload");
  await uploadMaterial(testUser.api, { course: examCourse, text: NOTES });
  await createPlan(testUser.api, { course_name: examCourse, exam_in_days: 7 });
  // Uploaded last, so it heads the course list.
  await uploadMaterial(testUser.api, { course: latestCourse, text: NOTES });

  await page.goto("/guides");
  await expect(page.getByRole("combobox", { name: "Course" })).toHaveText(examCourse);
  const panel = page.getByRole("tabpanel", { name: "Key concepts" });
  await expect(panel.getByRole("heading", { level: 2, name: `No key concepts guide for ${examCourse} yet` })).toBeVisible();
});
