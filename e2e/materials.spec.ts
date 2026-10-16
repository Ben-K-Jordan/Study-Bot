/**
 * Materials (/plan/materials): files grouped by course with their status in
 * words, Finish processing, dropping files on the upload zone (and the
 * type check before anything is sent), the summary toggle, and Delete with
 * its confirmation. Each test seeds its own identity, so the list holds only
 * its own files.
 *
 * Already covered elsewhere: upload, dedupe and processing rules in
 * src/__tests__/content-upload.test.ts and content-process-claim.test.ts,
 * and picking a file with the keyboard in plan.spec.ts.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { test, expect, hydrated, toasts, unique, uploadMaterial } from "./fixtures";

interface Doc {
  document_id: string;
  course_name: string | null;
  exam_name: string | null;
  original_filename: string;
  status: string;
}

async function listDocs(api: APIRequestContext): Promise<Doc[]> {
  const response = await api.get("/api/content/documents?namespace=COURSE");
  expect(response.status()).toBe(200);
  return (await response.json()).documents;
}

function courseGroup(page: Page, course: string) {
  return page.getByRole("region", { name: "Your materials" }).getByRole("region", { name: course });
}

test("files are listed by course with their status in plain words", { tag: "@mobile" }, async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Files");
  await uploadMaterial(testUser.api, { course, text: "Recursion: a function that calls itself until a base case." });
  await uploadMaterial(testUser.api, { course, fileName: "raw.md", text: "Hash tables map keys to buckets.", process: false });

  await page.goto("/plan/materials");
  const group = courseGroup(page, course);
  await expect(group.getByRole("heading", { level: 3, name: course })).toBeVisible();
  await expect(group.getByText("2 files", { exact: true })).toBeVisible();

  const ready = group.getByRole("listitem").filter({ hasText: "notes.txt" });
  await expect(ready).toContainText(/Text, added \w{3} \d{1,2}/);
  await expect(ready).toContainText("Ready");
  const waiting = group.getByRole("listitem").filter({ hasText: "raw.md" });
  await expect(waiting).toContainText(/Markdown, added \w{3} \d{1,2}/);
  await expect(waiting).toContainText("Uploaded");
  // Statuses are words, never the stored codes.
  await expect(group).not.toContainText(/PROCESSED|UPLOADED|PROCESSING|FAILED/);

  const finish = waiting.getByRole("button", { name: "Finish processing raw.md" });
  await hydrated(finish);
  await finish.click();
  await expect(waiting).toContainText("Ready");
  await expect(toasts(page)).toContainText("raw.md ready");
  await expect(waiting.getByRole("button", { name: "Summary of raw.md" })).toBeVisible();
  expect((await listDocs(testUser.api)).map((d) => d.status)).toEqual(["PROCESSED", "PROCESSED"]);
});

test("files dropped on the upload zone are checked, uploaded and processed", async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Drop");
  await page.goto("/plan/materials");
  const uploads = page.getByRole("region", { name: "Upload materials" });
  // The zone's name changes while files are dragged over it, so find it by its button.
  const zone = uploads.getByRole("group").filter({ has: page.getByRole("button", { name: "Choose files" }) });
  await expect(zone.getByRole("button", { name: "Choose files" })).toBeDisabled();
  await expect(zone).toHaveAccessibleDescription(/Enter the course name first\./);

  await hydrated(uploads.getByRole("combobox", { name: "Course" }));
  await uploads.getByRole("combobox", { name: "Course" }).fill(course);
  await uploads.getByRole("textbox", { name: "Exam (optional)" }).fill("Prelim 2");
  await expect(zone.getByRole("button", { name: "Choose files" })).toBeEnabled();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["# Hash tables\n\nKeys map to buckets through a hash function."], "lecture-2.md", { type: "text/markdown" }));
    transfer.items.add(new File(["not a document"], "slides.png", { type: "image/png" }));
    return transfer;
  });
  await zone.dispatchEvent("dragenter", { dataTransfer });
  await expect(zone).toHaveAccessibleName("Drop to upload");
  await zone.dispatchEvent("drop", { dataTransfer });
  await expect(zone).toHaveAccessibleName("Course files");

  const accepted = uploads.getByRole("listitem").filter({ hasText: "lecture-2.md" });
  await expect(accepted).toContainText(`Saved to ${course}, Prelim 2`);
  await expect(accepted).toContainText("Ready");
  const rejected = uploads.getByRole("listitem").filter({ hasText: "slides.png" });
  await expect(rejected).toContainText("Not uploaded");
  await expect(rejected).toContainText("Upload a PDF, text, or Markdown file up to 10 MB.");

  const listed = courseGroup(page, course).getByRole("listitem").filter({ hasText: "lecture-2.md" });
  await expect(listed).toContainText(/Markdown, added \w{3} \d{1,2}, for Prelim 2/);
  await expect(listed).toContainText("Ready");
  const docs = await listDocs(testUser.api);
  expect(docs.map((d) => [d.original_filename, d.course_name, d.exam_name, d.status])).toEqual([
    ["lecture-2.md", course, "Prelim 2", "PROCESSED"],
  ]);
});

test("a ready file's summary opens under its row", async ({ testUserPage: page, testUser }) => {
  const course = unique("E2E Summary");
  await uploadMaterial(testUser.api, { course, text: "Sorting: merge sort splits the list, sorts each half, then merges." });

  await page.goto("/plan/materials");
  const row = courseGroup(page, course).getByRole("listitem").filter({ hasText: "notes.txt" });
  const toggle = row.getByRole("button", { name: "Summary of notes.txt" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");

  await hydrated(toggle);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  // The mock AI writes no summaries, so the row says what still uses the file.
  const note = row.getByText("No summary for this file. Chat, flashcards, and guides still use its text.");
  await expect(note).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(note).toBeHidden();
});

test("Delete file asks first and removes the file", { tag: "@mobile" }, async ({ testUserPage: page, testUser }) => {
  const course = unique("E2E Remove");
  await uploadMaterial(testUser.api, { course, text: "Graphs: vertices joined by edges." });

  await page.goto("/plan/materials");
  const remove = courseGroup(page, course).getByRole("button", { name: "Delete notes.txt" });
  const dialog = page.getByRole("alertdialog", { name: "Delete notes.txt?" });

  await test.step("Cancel keeps it", async () => {
    await hydrated(remove);
    await remove.click();
    await expect(dialog).toContainText(
      `It comes out of your ${course} materials, so chat, new flashcards, and new guides stop using it. Decks and guides already made from it stay.`,
    );
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(remove).toBeFocused();
    expect(await listDocs(testUser.api)).toHaveLength(1);
  });

  await remove.click();
  await dialog.getByRole("button", { name: "Delete file" }).click();
  await expect(dialog).toBeHidden();
  await expect(toasts(page)).toContainText("File deleted");
  await expect(page.getByRole("heading", { name: "No materials yet" })).toBeVisible();
  // The row and its button are gone, so focus moves to the list's heading.
  await expect(page.getByRole("heading", { level: 2, name: "Your materials" })).toBeFocused();
  expect(await listDocs(testUser.api)).toEqual([]);
});

test("after Delete file with other files left, focus moves to the materials list heading", async ({
  testUserPage: page,
  testUser,
}) => {
  const course = unique("E2E Focus");
  await uploadMaterial(testUser.api, { course, text: "Trees: nodes with children." });
  await uploadMaterial(testUser.api, { course, fileName: "more.txt", text: "Heaps: a tree with an order rule." });

  await page.goto("/plan/materials");
  const remove = courseGroup(page, course).getByRole("button", { name: "Delete notes.txt" });
  await hydrated(remove);
  await remove.click();
  await page.getByRole("alertdialog", { name: "Delete notes.txt?" }).getByRole("button", { name: "Delete file" }).click();
  await expect(toasts(page)).toContainText("File deleted");
  await expect(page.getByRole("heading", { level: 2, name: "Your materials" })).toBeFocused();
});
