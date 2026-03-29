# Study Bot

Research-based study planner with session link generation and an interactive multi-mode terminal runner supporting retrieval practice, interleaved practice, exam simulation, and error repair.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **PostgreSQL** + **Prisma ORM** (v7 with `@prisma/adapter-pg`)
- **Zod v4** for validation
- **nanoid** for secure session IDs
- **Vitest** for testing

## Getting Started

### Prerequisites

- Node.js 20.19+ (or Node 22 LTS recommended; see `.nvmrc`)
- PostgreSQL database

### Setup

```bash
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL

npx prisma generate
npx prisma migrate dev --name init
npm run dev
```

### Running Tests

```bash
npm test
```

---

## API Reference

All endpoints require `X-User-Id` header (stub auth).

### Session Management

#### POST /api/sessions

Creates a study session. Returns deep link + calendar payload.

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{
    "course_name": "CS 2110",
    "exam_name": "Prelim 1",
    "mode": "RETRIEVAL",
    "topic_scope": "L3-L4",
    "planned_minutes": 80,
    "objectives": [{"id": "obj_34", "title": "Loops and invariants"}],
    "target_outcome": {"prompt_count": 20, "target_accuracy": 0.8, "closed_book_required": true},
    "break_protocol": {"type": "50_10", "cycles": 1}
  }'
```

#### GET /api/sessions/:sessionId

Returns session data. 403 if not owner.

### Session Runs (Terminal Runner)

#### POST /api/sessions/:sessionId/runs/start

Starts a new run or resumes an existing active run. Supports all four modes.

- Generates prompts from session objectives (mode-specific deck generation)
- Initializes break state, metrics, and mode-specific policies
- Returns 201 (new) or 200 (resumed)

```bash
curl -X POST http://localhost:3000/api/sessions/ABC123/runs/start \
  -H "X-User-Id: user_123"
```

**Response includes mode-specific fields:**

```json
{
  "run_id": "xYz789AbCdEfGhIjKlMn",
  "status": "ACTIVE",
  "mode": "RETRIEVAL",
  "phase": "ACTIVE",
  "policies": { "scoring": "IMMEDIATE" },
  "current_index": 0,
  "prompts": [...],
  "metrics": {...},
  "break_state": {...},
  "answered_count": 0,
  "scored_count": 0,
  "resumed": false
}
```

#### GET /api/runs/:runId

Returns full run state including attempts and error logs.

#### POST /api/runs/:runId/attempt

Submits an attempt for the current prompt. Payload format depends on mode.

**Legacy / Immediate scoring (RETRIEVAL, INTERLEAVED_PRACTICE, ERROR_REPAIR):**

```bash
curl -X POST http://localhost:3000/api/runs/xYz789/attempt \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{
    "prompt_index": 0,
    "user_answer": "A loop iterates over a block...",
    "self_score": "PARTIAL",
    "time_to_answer_seconds": 45,
    "error_log": {
      "error_type": "MEMORY",
      "correction_rule": "Loop invariant must hold before and after each iteration",
      "variant_question": "What are the three parts of a loop invariant proof?"
    }
  }'
```

**EXAM_SIM — Answer phase (`kind: "ANSWER"`):**

```bash
curl -X POST http://localhost:3000/api/runs/xYz789/attempt \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{
    "prompt_index": 0,
    "kind": "ANSWER",
    "user_answer": "My exam answer...",
    "time_to_answer_seconds": 60
  }'
```

**EXAM_SIM — Review phase (`kind: "SCORE"`):**

```bash
curl -X POST http://localhost:3000/api/runs/xYz789/attempt \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{
    "prompt_index": 0,
    "kind": "SCORE",
    "self_score": "INCORRECT",
    "error_log": {
      "error_type": "MISCONCEPTION",
      "correction_rule": "The correct approach is XYZ"
    }
  }'
```

**Error codes:** 409 if on break, wrong index, duplicate attempt, run completed, wrong phase for kind (e.g., SCORE during EXAM phase).

#### POST /api/runs/:runId/complete

Manually completes a run early. Computes spacing recommendations.

#### POST /api/runs/:runId/end-break

Ends the current break early and advances to the next work cycle.

---

## Study Modes

Four evidence-based study modes, each with distinct prompt decks and scoring policies:

| Mode | Scoring | Phase Flow | Prompt Deck |
|------|---------|------------|-------------|
| `RETRIEVAL` | Immediate | ACTIVE → COMPLETE | One prompt per objective, sequential |
| `INTERLEAVED_PRACTICE` | Immediate | ACTIVE → COMPLETE | Round-robin interleaving across objectives (deterministic seeded shuffle) |
| `EXAM_SIM` | Delayed (two-phase) | EXAM → REVIEW → COMPLETE | Same as retrieval, but answer all first, then self-score all |
| `ERROR_REPAIR` | Immediate | ACTIVE → COMPLETE | Repair prompts generated from unresolved error logs |

### EXAM_SIM Two-Phase Flow

1. **EXAM phase** — Answer every prompt without seeing feedback. Attempts are stored with `self_score = null`. SCORE requests are rejected (409).
2. **REVIEW phase** — After the last answer, phase transitions to REVIEW. The runner shows each saved answer and asks for self-scoring. ANSWER requests are rejected (409).
3. **COMPLETE** — After the last score, the run completes with full metrics including accuracy and recommended follow-ups.

### ERROR_REPAIR Flow

1. A prior session (any mode) must have produced error logs with `self_score = INCORRECT`.
2. Creating an `ERROR_REPAIR` session and starting a run fetches all unresolved error logs for the user.
3. Repair prompts reference the original error but do not reveal the correction rule.
4. Scoring a repair prompt `CORRECT` marks the source error log as resolved (`resolved_at` + `resolved_by_run_id`).
5. Resolved errors are excluded from future repair decks.

### Interleaved Practice

Prompts are distributed roughly equally across objectives using round-robin assignment with a deterministic seeded shuffle (Fisher-Yates with LCG PRNG). No more than 2 consecutive prompts share the same objective.

---

## Terminal Runner Flow

Visit `/s/:sessionId` in the browser to run an interactive session:

### 1. Preflight Screen
- Shows session details (course, exam, mode, target outcome, break protocol)
- EXAM_SIM shows a banner: "No feedback until the review phase"
- Requires three commitments: closed-book, phone away, honest grading
- "Start Session" or "Resume Session" button

### 2. Runner Screen
- Shows one prompt at a time with progress bar
- **Immediate modes** (RETRIEVAL, INTERLEAVED_PRACTICE, ERROR_REPAIR): Type answer, then self-score
- **EXAM_SIM EXAM phase**: Answer-only, no scoring UI, purple "EXAM MODE" banner
- **EXAM_SIM REVIEW phase**: Shows saved answer read-only, scoring buttons, blue "REVIEW PHASE" banner
- If Partial/Incorrect: log error type, correction rule, optional variant question
- Progress persisted after every attempt (survives refresh/crash)

### 3. Break Screen
- Triggered automatically based on break_protocol timing
- Countdown timer with suggestions (stretch, water, no phone)
- "End break early" option available
- Cannot submit attempts during break

### 4. End Screen
- Accuracy percentage, correct/partial/incorrect counts
- Time spent
- Score breakdown bar chart
- EXAM_SIM: shows answered/scored counts with two-phase indicator
- Spacing-based follow-up recommendations:
  - < 70% accuracy: next session in 1 and 2 days
  - 70-85%: 2 and 4 days
  - > 85%: 3 and 6 days

### Resumability
- Refreshing the page preserves all progress
- Active runs are automatically resumed (including EXAM_SIM mid-phase)
- Completed runs show the summary with option to start a new run

---

## Database Schema

Three tables support the terminal runner:

- **session_runs**: Tracks run state, prompts, metrics, break state. New fields: `mode`, `phase`, `policies` (JSONB), `answered_count`, `scored_count`
- **session_attempts**: Individual prompt answers with self-scores. `self_score` is now nullable (null during EXAM_SIM EXAM phase)
- **session_error_logs**: Error categorization and correction rules. New fields: `user_id`, `resolved_at`, `resolved_by_run_id` (for ERROR_REPAIR resolution tracking)

Run migrations:

```bash
npx prisma migrate dev --name add-session-runs
```

---

## Break Protocol Types

| Type | Work | Break |
|------|------|-------|
| `12_3` | 12 min | 3 min |
| `25_5` | 25 min | 5 min |
| `50_10` | 50 min | 10 min |
| `90_15` | 90 min | 15 min |

## Error Types

| Type | Description |
|------|-------------|
| `MISCONCEPTION` | Fundamental misunderstanding |
| `PROCEDURE` | Wrong steps/process |
| `CARELESS` | Knew it but made a mistake |
| `MEMORY` | Couldn't recall |
| `UNKNOWN` | Other |

---

## Testing

### Unit tests (no DB required)

```bash
npm run test:unit
```

Covers: session ID generation, validation schemas, break protocol logic, prompt generation, spacing recommendations, structured logger.

### Integration tests (requires PostgreSQL)

```bash
# Set up a test database
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/studybot_test" npm run test:integration
```

Covers: full session → run → attempt → complete flow, ownership enforcement (403), idempotent start/complete, duplicate attempt protection, break enforcement, 404 cases, DB integrity verification.

### E2E tests (requires PostgreSQL + browser)

```bash
# Install Playwright browsers (first time only)
npx playwright install --with-deps chromium

# Run E2E tests (starts dev server automatically)
npm run test:e2e
```

Covers: preflight screen rendering, prompt submission, error logging, page refresh resumability, completion summary, security (auth, cross-user), state validation (wrong index, post-completion, idempotent complete).

### Test break protocols

For deterministic testing, use these break protocols:

| Type | Work | Break | Use case |
|------|------|-------|----------|
| `TEST_1_1` | 1 sec | 1 sec | Fast break trigger |
| `TEST_3_2` | 3 sec | 2 sec | E2E tests |

---

## Hardening

- **Double-submit protection**: Unique constraint on `(run_id, prompt_index)` in session_attempts + application-level duplicate check
- **Transactional writes**: Attempt insert + error log + metrics update + index advance wrapped in a DB transaction
- **Idempotent start**: Calling start twice returns the same active run
- **Idempotent complete**: Calling complete on an already-completed run returns the existing result (no 409)
- **Strict validation**: `error_log` required when self_score is PARTIAL/INCORRECT; `time_to_answer_seconds` capped at 7200
- **Phase enforcement**: EXAM_SIM rejects SCORE during EXAM phase (409) and ANSWER during REVIEW phase (409)
- **Atomic error resolution**: ERROR_REPAIR marks error logs resolved in the same transaction as the CORRECT attempt

## Knowledge Layer

Make the app content-aware by uploading course materials, research papers, and practice questions.

### Three Namespaces

| Namespace | Purpose | Content |
|-----------|---------|---------|
| **Course Knowledge Base (CKB)** | Post-score feedback | Slides, notes, PDFs |
| **Practice Bank (PB)** | Question import | MCQ, short answer, coding prompts |
| **Study Science KB (SSKB)** | Policy rationales | Research papers + evidence cards |

### Upload + Process Documents

```bash
# Upload a course PDF
curl -X POST http://localhost:3000/api/content/documents \
  -H "X-User-Id: user_123" \
  -F "file=@notes.pdf" \
  -F "namespace=COURSE" \
  -F "course_name=CS 2110"

# Process into searchable chunks
curl -X POST http://localhost:3000/api/content/documents/{document_id}/process \
  -H "X-User-Id: user_123"

# Search
curl -X POST http://localhost:3000/api/content/search \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{"q": "loop invariant", "namespace": "COURSE", "course_name": "CS 2110"}'
```

Processing is explicit and resumable: upload returns immediately, processing is triggered separately. This avoids request timeouts on large documents and allows retry on failure.

### FTS-First Search

Search uses PostgreSQL full-text search (`plainto_tsquery` + `ts_rank_cd` + `ts_headline`). This is fast (<300ms P95 for <=2,000 chunks) and requires no external services. Vector/embedding search will layer on top in a future sprint.

### Practice Bank Import

```bash
# Create a practice set
curl -X POST http://localhost:3000/api/practice-sets \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{"course_name": "CS 2110", "title": "Midterm Prep"}'

# Import questions (JSON format)
curl -X POST http://localhost:3000/api/practice-sets/{id}/import \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{"questions": [
    {"kind": "SHORT_ANSWER", "prompt_text": "Define loop invariant"},
    {"kind": "MCQ", "prompt_text": "Which is correct? A/B/C", "answer_key": "B"},
    {"kind": "CODING", "prompt_text": "Write binary search", "solution_steps": "1. Init low/high..."}
  ]}'
```

### Evidence Cards (SSKB)

```bash
# Upload research paper, then create evidence paper + cards
curl -X POST http://localhost:3000/api/evidence/papers \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{"title": "The Testing Effect", "document_id": "...", "tags": ["retrieval_practice"]}'

curl -X POST http://localhost:3000/api/evidence/papers/{id}/cards \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{"claim": "Retrieval practice enhances retention", "recommendation": "Use self-testing", "strength": "STRONG"}'
```

### Runner Feedback + No-Leakage Guardrail

**STRICT PEDAGOGY GUARDRAIL**: No excerpts, hints, or citations are shown BEFORE the user answers. Closed-book retrieval is preserved.

After scoring PARTIAL or INCORRECT:
1. The attempt transaction commits first (fast, atomic)
2. FTS search runs against the user's course materials (AFTER commit)
3. Up to 5 cited excerpts are displayed in a "REVIEW (from your materials)" panel
4. `AttemptCitation` rows are stored for audit/analytics

If feedback search fails, the attempt is NOT affected — feedback is best-effort.

### Library Page

Visit `/library` to manage all three namespaces:
- **Course Materials tab**: Upload, process, list, and search documents
- **Practice Bank tab**: Create sets and import questions
- **Research Library tab**: Upload papers and create evidence cards

---

## Observability

- **Structured JSON logs** via `src/lib/logger.ts` — events: `session.created`, `run.started`, `run.resumed`, `prompt.submitted`, `break.started`, `break.ended`, `run.completed`
- **Error reporter** stub at `src/lib/error-reporter.ts` — replace with Sentry/Datadog in production
- Logs suppressed in test environment unless `LOG_LEVEL=debug`

## Week Planner

Generate a 7-day study plan with automatic session creation and calendar export.

### Creating a Plan

Visit `/plan` in the browser or use the API:

```bash
curl -X POST http://localhost:3000/api/plans \
  -H "Content-Type: application/json" \
  -H "X-User-Id: user_123" \
  -d '{
    "course_name": "CS 2110",
    "exam_name": "Prelim 1",
    "exam_date": "2024-03-15",
    "objectives": ["Loops and invariants", "Recursion", "Linked lists", "Stacks and queues", "Big-O analysis"],
    "availability": [
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"},
      {"start": "09:00", "end": "17:00"}
    ],
    "daily_study_cap_minutes": 180,
    "break_protocol_default": "50_10"
  }'
```

### Downloading ICS Calendar File

```bash
curl http://localhost:3000/api/plans/{plan_id}/ics \
  -H "X-User-Id: user_123" \
  -o study-plan.ics
```

Import the `.ics` file into Google Calendar, Apple Calendar, or Outlook.

### Plan Schedule

| Day | Sessions |
|-----|----------|
| 0 | Diagnostic Retrieval (short) + Retrieval pack A |
| 1 | Retrieval pack B |
| 2 | Interleaved Practice (A+B mixed) |
| 3 | Retrieval pack C (or revisit A) |
| 4 | Interleaved Practice (B+C mixed) |
| 5 | Exam Sim + Error Repair |
| 6 | Final mixed Retrieval (all packs) |

---

## Running Tests Locally

```bash
# Unit tests (no DB required)
npm run test:unit

# Integration tests (requires PostgreSQL)
DATABASE_URL=postgresql://user:pass@localhost:5432/studybot_test npm run test:integration

# E2E tests (requires PostgreSQL + running app)
DATABASE_URL=postgresql://user:pass@localhost:5432/studybot_e2e npm run test:e2e
```

### Test Coverage

| Category | Files | What's tested |
|----------|-------|---------------|
| Unit: plan-generator | `plan-generator.test.ts` | Pedagogical invariants, schedule validity, determinism, edge cases |
| Unit: ICS | `ics.test.ts` | Structure, field parsing, UID uniqueness, escaping, deep links, determinism |
| Unit: validation | `validation-plan.test.ts` | Plan schema: defaults, constraints, error cases |
| Unit: validation (modes) | `validation-attempt-modes.test.ts` | `parseAttemptPayload` discriminated union, ANSWER/SCORE schemas, legacy compat |
| Unit: prompts (modes) | `prompts-modes.test.ts` | Interleaved generation, deterministic shuffle, error repair deck, distribution |
| Integration: plan flow | `plan-flow.test.ts` | Plan creation, DB integrity, ICS export, plan→run continuity, ownership |
| Integration: session flow | `full-flow.test.ts` | Session→run→attempt→complete, breaks, idempotency |
| Integration: mode parity | `mode-parity.test.ts` | All 4 modes end-to-end, EXAM_SIM phases, ERROR_REPAIR resolution, ownership |
| E2E: plan-to-run | `plan-to-run.spec.ts` | API plan creation, ICS download, session launch, attempt, resume |
| E2E: session runner | `session-runner.spec.ts` | Full UI flow, security, state validation |
| E2E: mode parity | `mode-parity.spec.ts` | Interleaved/ExamSim/ErrorRepair runners, phase transitions, UI rendering |
| Unit: chunker | `chunker.test.ts` | Deterministic output, size bounds, overlap, ordinals, page-aware, edge cases |
| Unit: storage/hashing | `storage-hashing.test.ts` | SHA-256 consistency, uniqueness, storage key building |
| Unit: search query | `search-query.test.ts` | Feedback query composition, truncation, optional params |
| Unit: content validation | `validation-content.test.ts` | Upload, search, practice, evidence schemas |
| Integration: knowledge layer | `knowledge-layer.test.ts` | Upload+process+search, ownership, dedupe, citations, practice bank, evidence |
| E2E: knowledge layer | `knowledge-layer.spec.ts` | Leak prevention (no excerpts before answer), feedback after scoring, library page |

## CI Pipeline

GitHub Actions workflow at `.github/workflows/quality-gate.yml`:

1. **Lint & Typecheck** — `tsc --noEmit`
2. **Unit Tests** — fast, no DB
3. **Integration Tests** — with PostgreSQL service container
4. **E2E Tests** — Playwright headless against built app + PostgreSQL

## Architecture Notes: Knowledge Layer

### Why processing is explicit and resumable
Upload and processing are separate steps. Upload saves the file and returns immediately (no timeout risk). Processing extracts text, chunks it, and indexes it — which may take seconds for large PDFs. If processing fails, the document stays in FAILED status with an error message, and can be retried. This also enables future background/queue-based processing.

### Why FTS-first (and how embeddings will layer in later)
PostgreSQL full-text search (`tsvector` + `tsquery`) is fast, requires no external dependencies, and handles the MVP use case well. The schema is designed so that adding an `embedding` column (e.g., `pgvector`) to `ContentChunk` is a non-breaking additive change. A future sprint can add embedding-based search as a ranking signal alongside FTS, using the same chunk rows.

### How citations are stored and leakage is prevented
- **Storage**: `AttemptCitation` rows link `attempt_id` → `chunk_id` with rank and displayed snippet. This enables future analytics ("which excerpts helped students improve?").
- **Leakage prevention**: The runner UI has no access to CKB content before scoring. The API only returns `feedback` in the attempt response AFTER the scoring transaction commits. The UI enforces this with a `review` UIPhase that only renders after scoring completes. The E2E test explicitly verifies no excerpt content appears before answer submission.
- **Immutability**: Chunks are never updated in place. If a document changes (different `content_hash`), new chunks are created. This keeps citation references stable.

### New dependencies
- **pdf-parse** (v1.1.1): Lightweight PDF text extraction. Chosen for simplicity and zero native dependencies. Will be replaced with pdfjs-dist if page-level extraction is needed.
