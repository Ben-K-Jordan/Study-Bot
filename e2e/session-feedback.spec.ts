/**
 * Feedback from the student's materials: nothing from them shows before
 * the answer is scored, and the feedback section appears after it, citing
 * the file that covers the topic.
 */
import { test, expect, createSession, uploadMaterial, unique } from "./fixtures";

const NOTES = [
  "Introduction to graph algorithms",
  "Dijkstra's shortest path algorithm uses a priority queue to pick the closest unvisited vertex.",
  "Bellman-Ford handles negative edge weights but is slower.",
].join("\n\n");

test("feedback stays hidden until the answer is scored", async ({ page, request }) => {
  const course = unique("E2E Graphs");
  await uploadMaterial(request, { course, fileName: "graphs.txt", text: NOTES });
  const session = await createSession(request, { course_name: course, topic_scope: "Dijkstra's algorithm" });

  await page.goto(session.url);
  await page.getByRole("button", { name: "Start session" }).click();
  const main = page.getByRole("main");
  await expect(main.getByRole("textbox", { name: "Your answer" })).toBeVisible();

  await test.step("before an answer: no feedback and no text from the materials", async () => {
    await expect(main.getByRole("region", { name: "Feedback from your materials" })).toHaveCount(0);
    await expect(main).not.toContainText("priority queue");
  });

  await test.step("after an incorrect answer and its correction: the feedback section", async () => {
    await main.getByRole("textbox", { name: "Your answer" }).fill("Dijkstra explores vertices in plain BFS order");
    await page.getByRole("button", { name: "Submit answer" }).click();
    // Scoring shows the answer, still without feedback.
    await expect(page.getByRole("group", { name: "Score your answer" })).toBeVisible();
    await expect(main.getByRole("region", { name: "Feedback from your materials" })).toHaveCount(0);

    await page.getByRole("button", { name: "Incorrect", exact: true }).click();
    await main.getByRole("textbox", { name: "Correction rule" }).fill("Dijkstra picks the closest vertex from a priority queue");
    await page.getByRole("button", { name: "Save correction" }).click();

    const feedback = main.getByRole("region", { name: "Feedback from your materials" });
    await expect(feedback).toBeVisible();
    await expect(feedback.getByRole("region", { name: "Your correction" })).toContainText(
      "Dijkstra picks the closest vertex from a priority queue",
    );
    // The deferred feedback finishes loading. The uploaded notes cover
    // Dijkstra's algorithm, so it cites them: the search matches any of the
    // question's words, not all of them, and never claims they don't cover it.
    await expect(feedback.getByText("Loading feedback…")).toHaveCount(0);
    const sources = feedback.getByRole("region", { name: "Sources" });
    await expect(sources).toBeVisible();
    await expect(sources).toContainText("priority queue");
    await expect(feedback).not.toContainText("Your materials don't cover this question");
  });
});
