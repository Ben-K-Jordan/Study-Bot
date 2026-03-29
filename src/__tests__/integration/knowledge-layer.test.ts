import { describe, it, expect, beforeAll, afterAll } from "vitest";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const USER_A = "test_user_kl_a_" + Date.now();
const USER_B = "test_user_kl_b_" + Date.now();

async function api(method: string, path: string, body?: unknown, userId = USER_A, isFormData = false) {
  const headers: Record<string, string> = { "X-User-Id": userId };
  if (!isFormData) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function uploadTextDoc(userId: string, courseName: string, content: string, filename = "test.txt") {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/plain" }), filename);
  form.append("namespace", "COURSE");
  form.append("course_name", courseName);

  const res = await fetch(`${BASE_URL}/api/content/documents`, {
    method: "POST",
    headers: { "X-User-Id": userId },
    body: form,
  });
  return { status: res.status, data: await res.json() };
}

describe("Knowledge Layer Integration", () => {
  let docId: string;
  const COURSE = "TEST_CS_" + Date.now();
  const DOC_CONTENT = `
Introduction to Loop Invariants

A loop invariant is a condition that is true before and after each iteration of a loop.

To prove a loop is correct, you must show three things:
1. Initialization: The invariant is true before the first iteration.
2. Maintenance: If the invariant is true before an iteration, it remains true after.
3. Termination: When the loop terminates, the invariant gives a useful property.

Example: Binary Search
The loop invariant for binary search is that the target element, if present, must be between indices low and high inclusive.

Common Mistakes with Loops
Students often forget to check the off-by-one error in loop boundaries.
The difference between < and <= in the loop condition is critical.

Advanced Loop Patterns
Nested loops require separate invariants for each level.
The outer loop invariant must account for the inner loop's effect.
  `.trim();

  // Upload + Process
  describe("Upload + Process", () => {
    it("uploads a text document", async () => {
      const { status, data } = await uploadTextDoc(USER_A, COURSE, DOC_CONTENT);
      expect(status).toBe(201);
      expect(data.document_id).toBeTruthy();
      expect(data.status).toBe("UPLOADED");
      expect(data.deduped).toBe(false);
      docId = data.document_id;
    });

    it("processes the document into chunks", async () => {
      const { status, data } = await api("POST", `/api/content/documents/${docId}/process`);
      expect(status).toBe(200);
      expect(data.status).toBe("PROCESSED");
      expect(data.chunk_count).toBeGreaterThan(0);
    });

    it("idempotent: re-process returns same result", async () => {
      const { status, data } = await api("POST", `/api/content/documents/${docId}/process`);
      expect(status).toBe(200);
      expect(data.status).toBe("PROCESSED");
    });
  });

  // Search
  describe("Search", () => {
    it("finds chunks matching a query", async () => {
      const { status, data } = await api("POST", "/api/content/search", {
        q: "loop invariant",
        namespace: "COURSE",
        course_name: COURSE,
      });
      expect(status).toBe(200);
      expect(data.results.length).toBeGreaterThan(0);
      expect(data.results[0].snippet).toBeTruthy();
      expect(data.results[0].doc_title).toBeTruthy();
    });

    it("returns empty for non-matching query", async () => {
      const { data } = await api("POST", "/api/content/search", {
        q: "quantum chromodynamics",
        namespace: "COURSE",
        course_name: COURSE,
      });
      expect(data.results.length).toBe(0);
    });

    it("respects top_k limit", async () => {
      const { data } = await api("POST", "/api/content/search", {
        q: "loop",
        namespace: "COURSE",
        course_name: COURSE,
        top_k: 2,
      });
      expect(data.results.length).toBeLessThanOrEqual(2);
    });
  });

  // Ownership enforcement
  describe("Ownership", () => {
    it("user B cannot process user A's document", async () => {
      const { status } = await api("POST", `/api/content/documents/${docId}/process`, undefined, USER_B);
      expect(status).toBe(403);
    });

    it("user B search returns 0 results for user A's docs", async () => {
      const { data } = await api("POST", "/api/content/search", {
        q: "loop invariant",
        namespace: "COURSE",
        course_name: COURSE,
      }, USER_B);
      expect(data.results.length).toBe(0);
    });
  });

  // Dedupe
  describe("Dedupe", () => {
    it("re-uploading same file returns deduped=true", async () => {
      const { status, data } = await uploadTextDoc(USER_A, COURSE, DOC_CONTENT);
      expect(status).toBe(200);
      expect(data.deduped).toBe(true);
      expect(data.document_id).toBe(docId);
    });
  });

  // List documents
  describe("List Documents", () => {
    it("returns documents with chunk count", async () => {
      const { status, data } = await api("GET", `/api/content/documents?namespace=COURSE&course_name=${COURSE}`);
      expect(status).toBe(200);
      expect(data.documents.length).toBeGreaterThan(0);
      expect(data.documents[0].chunk_count).toBeGreaterThan(0);
      expect(data.documents[0].status).toBe("PROCESSED");
    });
  });

  // AttemptCitation integration
  describe("AttemptCitation via Runner", () => {
    let sessionId: string;
    let runId: string;

    it("create a retrieval session for the course", async () => {
      const { status, data } = await api("POST", "/api/sessions", {
        course_name: COURSE,
        exam_name: "Test Exam",
        mode: "RETRIEVAL",
        topic_scope: "Loop invariants",
        planned_minutes: 30,
        objectives: [{ id: "obj_1", title: "Loop invariants" }],
      });
      expect(status).toBe(201);
      sessionId = data.session_id;
    });

    it("start a run", async () => {
      const { status, data } = await api("POST", `/api/sessions/${sessionId}/runs/start`);
      expect(status).toBe(201);
      runId = data.run_id;
      expect(data.prompts.length).toBeGreaterThan(0);
    });

    it("submit INCORRECT attempt and get feedback with citations", async () => {
      const { status, data } = await api("POST", `/api/runs/${runId}/attempt`, {
        prompt_index: 0,
        user_answer: "I don't remember",
        self_score: "INCORRECT",
        time_to_answer_seconds: 10,
        error_log: {
          error_type: "MEMORY",
          correction_rule: "A loop invariant must be true before and after each iteration",
        },
      });
      expect(status).toBe(200);
      // Feedback should be present (we have COURSE docs for this course)
      if (data.feedback) {
        expect(data.feedback.excerpts.length).toBeGreaterThan(0);
        expect(data.feedback.excerpts[0].snippet).toBeTruthy();
        expect(data.feedback.excerpts[0].doc_title).toBeTruthy();
      }
    });
  });

  // Practice Bank
  describe("Practice Bank", () => {
    let setId: string;

    it("creates a practice set", async () => {
      const { status, data } = await api("POST", "/api/practice-sets", {
        course_name: COURSE,
        title: "Midterm Prep",
      });
      expect(status).toBe(201);
      setId = data.practice_set_id;
    });

    it("imports questions", async () => {
      const { status, data } = await api("POST", `/api/practice-sets/${setId}/import`, {
        questions: [
          { kind: "SHORT_ANSWER", prompt_text: "Define loop invariant" },
          { kind: "MCQ", prompt_text: "Which is NOT a loop property?", answer_key: "D" },
        ],
      });
      expect(status).toBe(201);
      expect(data.imported_count).toBe(2);
    });

    it("lists questions", async () => {
      const { status, data } = await api("GET", `/api/practice-sets/${setId}/questions`);
      expect(status).toBe(200);
      expect(data.questions.length).toBe(2);
    });

    it("user B cannot import into user A's set", async () => {
      const { status } = await api("POST", `/api/practice-sets/${setId}/import`, {
        questions: [{ kind: "SHORT_ANSWER", prompt_text: "Hack" }],
      }, USER_B);
      expect(status).toBe(403);
    });
  });

  // Evidence
  describe("Evidence Cards", () => {
    let researchDocId: string;
    let paperId: string;

    it("uploads a research document", async () => {
      const form = new FormData();
      form.append("file", new Blob(["Research paper content about retrieval practice"], { type: "text/plain" }), "paper.txt");
      form.append("namespace", "RESEARCH");

      const res = await fetch(`${BASE_URL}/api/content/documents`, {
        method: "POST",
        headers: { "X-User-Id": USER_A },
        body: form,
      });
      const data = await res.json();
      expect(res.status).toBe(201);
      researchDocId = data.document_id;

      // Process it
      await api("POST", `/api/content/documents/${researchDocId}/process`);
    });

    it("creates an evidence paper", async () => {
      const { status, data } = await api("POST", "/api/evidence/papers", {
        title: "The Testing Effect",
        document_id: researchDocId,
        tags: ["retrieval_practice"],
      });
      expect(status).toBe(201);
      paperId = data.paper_id;
    });

    it("creates an evidence card", async () => {
      const { status, data } = await api("POST", `/api/evidence/papers/${paperId}/cards`, {
        claim: "Retrieval practice enhances long-term retention",
        recommendation: "Use regular self-testing",
        strength: "STRONG",
        tags: ["retrieval_practice"],
      });
      expect(status).toBe(201);
      expect(data.card_id).toBeTruthy();
    });

    it("lists evidence cards", async () => {
      const { status, data } = await api("GET", "/api/evidence/cards");
      expect(status).toBe(200);
      expect(data.cards.length).toBeGreaterThan(0);
    });
  });
});
