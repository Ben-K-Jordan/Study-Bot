import { test, expect } from "@playwright/test";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// ============================================================
// E2E: Interleaved Practice runner
// ============================================================

test.describe.serial("E2E: Interleaved Practice runner", () => {
  const USER_ID = "e2e_interleaved_user";
  let sessionId: string;
  let runId: string;
  let promptCount: number;

  test("create INTERLEAVED_PRACTICE session", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: "E2E Interleaved",
        exam_name: "Test 1",
        mode: "INTERLEAVED_PRACTICE",
        topic_scope: "Ch1-Ch2",
        planned_minutes: 30,
        objectives: [
          { id: "obj_a", title: "Loops and iteration" },
          { id: "obj_b", title: "Array manipulation" },
        ],
        target_outcome: { prompt_count: 6 },
        break_protocol: { type: "TEST_3_2", cycles: 1 },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    sessionId = body.session_id;
  });

  test("start run returns mode=INTERLEAVED_PRACTICE, prompts alternate objectives", async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/sessions/${sessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body.mode).toBe("INTERLEAVED_PRACTICE");
    expect(body.phase).toBe("ACTIVE");
    expect(body.policies.scoring).toBe("IMMEDIATE");
    expect(body.prompts.length).toBe(6);

    // Verify first two prompts have different objective_ids
    expect(body.prompts[0].objective_id).not.toBe(body.prompts[1].objective_id);

    runId = body.run_id;
    promptCount = body.prompts.length;
  });

  test("complete all prompts with immediate scoring", async ({ request }) => {
    for (let i = 0; i < promptCount; i++) {
      const res = await request.post(
        `${BASE_URL}/api/runs/${runId}/attempt`,
        {
          headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
          data: {
            prompt_index: i,
            user_answer: `Interleaved answer ${i}`,
            self_score: i % 3 === 0 ? "INCORRECT" : "CORRECT",
            time_to_answer_seconds: 10,
            ...(i % 3 === 0
              ? {
                  error_log: {
                    error_type: "MEMORY",
                    correction_rule: "Remember the rule",
                  },
                }
              : {}),
          },
        }
      );
      expect(res.status()).toBe(200);
    }

    // Verify run completed
    const run = await request.get(`${BASE_URL}/api/runs/${runId}`, {
      headers: { "X-User-Id": USER_ID },
    });
    const body = await run.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.metrics.attempts_count).toBe(6);
  });

  test("session page renders in browser", async ({ page }) => {
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("E2E Interleaved")).toBeVisible();
    await expect(page.getByText("Interleaved Practice")).toBeVisible();
  });
});

// ============================================================
// E2E: Exam Sim runner
// ============================================================

test.describe.serial("E2E: Exam Sim runner", () => {
  const USER_ID = "e2e_examsim_user";
  let sessionId: string;
  let runId: string;

  test("create EXAM_SIM session with 3 prompts", async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: "E2E ExamSim",
        exam_name: "Final",
        mode: "EXAM_SIM",
        topic_scope: "All",
        planned_minutes: 60,
        objectives: [
          { id: "obj_1", title: "Topic A" },
          { id: "obj_2", title: "Topic B" },
        ],
        target_outcome: { prompt_count: 3 },
        break_protocol: { type: "TEST_3_2", cycles: 1 },
      },
    });
    expect(res.status()).toBe(201);
    sessionId = (await res.json()).session_id;
  });

  test("start run returns phase=EXAM with DELAYED scoring", async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/sessions/${sessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(res.status()).toBe(201);
    const body = await res.json();

    expect(body.mode).toBe("EXAM_SIM");
    expect(body.phase).toBe("EXAM");
    expect(body.policies.scoring).toBe("DELAYED");
    expect(body.prompts).toHaveLength(3);
    expect(body.answered_count).toBe(0);
    expect(body.scored_count).toBe(0);
    runId = body.run_id;
  });

  test("SCORE rejected during EXAM phase (409)", async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/runs/${runId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: { prompt_index: 0, kind: "SCORE", self_score: "CORRECT" },
      }
    );
    expect(res.status()).toBe(409);
  });

  test("answer all 3 prompts, last answer transitions to REVIEW", async ({ request }) => {
    for (let i = 0; i < 3; i++) {
      const res = await request.post(
        `${BASE_URL}/api/runs/${runId}/attempt`,
        {
          headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
          data: {
            prompt_index: i,
            kind: "ANSWER",
            user_answer: `Exam answer ${i}`,
            time_to_answer_seconds: 20,
          },
        }
      );
      expect(res.status()).toBe(200);
      const body = await res.json();

      if (i < 2) {
        expect(body.phase).toBe("EXAM");
        expect(body.answered_count).toBe(i + 1);
      } else {
        // Last answer transitions to REVIEW
        expect(body.phase).toBe("REVIEW");
        expect(body.current_index).toBe(0);
        expect(body.answered_count).toBe(3);
      }
    }
  });

  test("ANSWER rejected during REVIEW phase (409)", async ({ request }) => {
    const res = await request.post(
      `${BASE_URL}/api/runs/${runId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: { prompt_index: 0, kind: "ANSWER", user_answer: "should fail" },
      }
    );
    expect(res.status()).toBe(409);
  });

  test("score all prompts with one INCORRECT + error log, run completes", async ({ request }) => {
    // Score prompt 0: CORRECT
    const r0 = await request.post(
      `${BASE_URL}/api/runs/${runId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: { prompt_index: 0, kind: "SCORE", self_score: "CORRECT" },
      }
    );
    expect(r0.status()).toBe(200);
    expect((await r0.json()).scored_count).toBe(1);

    // Score prompt 1: INCORRECT with error log
    const r1 = await request.post(
      `${BASE_URL}/api/runs/${runId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: {
          prompt_index: 1,
          kind: "SCORE",
          self_score: "INCORRECT",
          error_log: {
            error_type: "MISCONCEPTION",
            correction_rule: "The correct approach is XYZ",
            variant_question: "Why does XYZ work?",
          },
        },
      }
    );
    expect(r1.status()).toBe(200);
    expect((await r1.json()).scored_count).toBe(2);

    // Score prompt 2: CORRECT — should complete
    const r2 = await request.post(
      `${BASE_URL}/api/runs/${runId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: { prompt_index: 2, kind: "SCORE", self_score: "CORRECT" },
      }
    );
    expect(r2.status()).toBe(200);
    const body = await r2.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.phase).toBe("COMPLETE");
    expect(body.scored_count).toBe(3);
    expect(body.metrics.accuracy).toBeCloseTo(2 / 3, 2);
    expect(body.metrics.recommended_followups).toBeDefined();
  });

  test("GET run shows all attempts with scores", async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/runs/${runId}`, {
      headers: { "X-User-Id": USER_ID },
    });
    const body = await res.json();
    expect(body.status).toBe("COMPLETED");
    expect(body.mode).toBe("EXAM_SIM");
    expect(body.attempts).toHaveLength(3);
    // All should now have self_score set
    expect(body.attempts[0].self_score).toBe("CORRECT");
    expect(body.attempts[1].self_score).toBe("INCORRECT");
    expect(body.attempts[2].self_score).toBe("CORRECT");
  });

  test("session page renders exam sim label", async ({ page }) => {
    await page.goto(`/s/${sessionId}`);
    await expect(page.getByText("E2E ExamSim")).toBeVisible();
    await expect(page.getByText("Exam Sim")).toBeVisible();
  });
});

// ============================================================
// E2E: Error Repair runner
// ============================================================

test.describe.serial("E2E: Error Repair runner", () => {
  const USER_ID = "e2e_errorrepair_user";
  let retrievalSessionId: string;
  let retrievalRunId: string;
  let repairSessionId: string;
  let repairRunId: string;

  // Step 1: Create retrieval session and generate error log
  test("create retrieval session and submit INCORRECT with error log", async ({ request }) => {
    // Create session
    const sessRes = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: "E2E Repair",
        exam_name: "Quiz",
        mode: "RETRIEVAL",
        topic_scope: "Errors",
        planned_minutes: 15,
        objectives: [{ id: "obj_1", title: "Exception handling" }],
        target_outcome: { prompt_count: 2 },
        break_protocol: { type: "TEST_3_2", cycles: 1 },
      },
    });
    expect(sessRes.status()).toBe(201);
    retrievalSessionId = (await sessRes.json()).session_id;

    // Start run
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${retrievalSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(startRes.status()).toBe(201);
    retrievalRunId = (await startRes.json()).run_id;

    // Submit INCORRECT with error log
    const a0 = await request.post(
      `${BASE_URL}/api/runs/${retrievalRunId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: {
          prompt_index: 0,
          user_answer: "Wrong approach to exceptions",
          self_score: "INCORRECT",
          time_to_answer_seconds: 20,
          error_log: {
            error_type: "MISCONCEPTION",
            correction_rule: "Always use try-catch for recoverable errors",
            variant_question: "When should you use checked vs unchecked exceptions?",
          },
        },
      }
    );
    expect(a0.status()).toBe(200);

    // Complete with CORRECT
    const a1 = await request.post(
      `${BASE_URL}/api/runs/${retrievalRunId}/attempt`,
      {
        headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
        data: {
          prompt_index: 1,
          user_answer: "Correct answer",
          self_score: "CORRECT",
          time_to_answer_seconds: 10,
        },
      }
    );
    expect(a1.status()).toBe(200);
    expect((await a1.json()).status).toBe("COMPLETED");
  });

  // Step 2: Create ERROR_REPAIR session and start it
  test("create ERROR_REPAIR session and start run with repair prompts", async ({ request }) => {
    const sessRes = await request.post(`${BASE_URL}/api/sessions`, {
      headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
      data: {
        course_name: "E2E Repair",
        exam_name: "Quiz",
        mode: "ERROR_REPAIR",
        topic_scope: "Errors",
        planned_minutes: 15,
        target_outcome: { prompt_count: 5 },
        break_protocol: { type: "TEST_3_2", cycles: 1 },
      },
    });
    expect(sessRes.status()).toBe(201);
    repairSessionId = (await sessRes.json()).session_id;

    // Start repair run
    const startRes = await request.post(
      `${BASE_URL}/api/sessions/${repairSessionId}/runs/start`,
      { headers: { "X-User-Id": USER_ID } }
    );
    expect(startRes.status()).toBe(201);
    const body = await startRes.json();

    expect(body.mode).toBe("ERROR_REPAIR");
    expect(body.phase).toBe("ACTIVE");
    expect(body.prompts.length).toBeGreaterThanOrEqual(1);

    // First prompt should be a repair prompt referencing the error
    expect(body.prompts[0].meta?.source_error_log_id).toBeDefined();
    expect(body.prompts[0].text).toContain("From memory");

    repairRunId = body.run_id;
  });

  // Step 3: Score CORRECT and verify completion + error log resolved
  test("CORRECT repair completes run", async ({ request }) => {
    // Get prompts to know how many to answer
    const runRes = await request.get(`${BASE_URL}/api/runs/${repairRunId}`, {
      headers: { "X-User-Id": USER_ID },
    });
    const run = await runRes.json();
    const prompts = run.prompts;

    for (let i = 0; i < prompts.length; i++) {
      const res = await request.post(
        `${BASE_URL}/api/runs/${repairRunId}/attempt`,
        {
          headers: { "Content-Type": "application/json", "X-User-Id": USER_ID },
          data: {
            prompt_index: i,
            user_answer: "Correct repair: always use try-catch",
            self_score: "CORRECT",
            time_to_answer_seconds: 15,
          },
        }
      );
      expect(res.status()).toBe(200);
    }

    // Verify completed
    const finalRes = await request.get(`${BASE_URL}/api/runs/${repairRunId}`, {
      headers: { "X-User-Id": USER_ID },
    });
    const finalRun = await finalRes.json();
    expect(finalRun.status).toBe("COMPLETED");
    expect(finalRun.metrics.accuracy).toBe(1);
  });

  test("session page renders error repair label", async ({ page }) => {
    await page.goto(`/s/${repairSessionId}`);
    await expect(page.getByText("E2E Repair")).toBeVisible();
    await expect(page.getByText("Error Repair")).toBeVisible();
  });
});
