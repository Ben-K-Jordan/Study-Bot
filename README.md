# Study Bot

Research-based study planner with session link generation and an interactive retrieval practice terminal runner.

## Stack

- **Next.js 14** (App Router) + TypeScript
- **PostgreSQL** + **Prisma ORM** (v7 with `@prisma/adapter-pg`)
- **Zod v4** for validation
- **nanoid** for secure session IDs
- **Vitest** for testing

## Getting Started

### Prerequisites

- Node.js 18+
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

Starts a new retrieval run or resumes an existing active run.

- Generates prompts from session objectives
- Initializes break state and metrics
- Returns 201 (new) or 200 (resumed)

```bash
curl -X POST http://localhost:3000/api/sessions/ABC123/runs/start \
  -H "X-User-Id: user_123"
```

**Response:**

```json
{
  "run_id": "xYz789AbCdEfGhIjKlMn",
  "status": "ACTIVE",
  "current_index": 0,
  "prompts": [
    {"id": "p_0", "objective_id": "obj_34", "text": "From memory: explain Loops and invariants in 3-5 bullets.", "difficulty": 1}
  ],
  "metrics": {"attempts_count": 0, "correct_count": 0, "partial_count": 0, "incorrect_count": 0, "accuracy": 0, "time_spent_seconds": 0},
  "break_state": {"work_started_at": "...", "current_cycle": 0, "total_cycles": 1, "on_break": false, "work_duration_seconds": 3000, "break_duration_seconds": 600, "completed_breaks": []},
  "resumed": false
}
```

#### GET /api/runs/:runId

Returns full run state including attempts and error logs.

#### POST /api/runs/:runId/attempt

Submits an answer + self-score for the current prompt.

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

**Error codes:** 409 if on break, wrong index, duplicate attempt, or run completed.

#### POST /api/runs/:runId/complete

Manually completes a run early. Computes spacing recommendations.

#### POST /api/runs/:runId/end-break

Ends the current break early and advances to the next work cycle.

---

## Terminal Runner Flow

Visit `/s/:sessionId` in the browser to run an interactive session:

### 1. Preflight Screen
- Shows session details (course, exam, mode, target outcome, break protocol)
- Requires three commitments: closed-book, phone away, honest grading
- "Start Session" or "Resume Session" button

### 2. Runner Screen
- Shows one prompt at a time with progress bar
- Type answer in textarea, then self-score: Correct / Partial / Incorrect
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
- Spacing-based follow-up recommendations:
  - < 70% accuracy: next session in 1 and 2 days
  - 70-85%: 2 and 4 days
  - > 85%: 3 and 6 days

### Resumability
- Refreshing the page preserves all progress
- Active runs are automatically resumed
- Completed runs show the summary with option to start a new run

---

## Database Schema

Three new tables support the terminal runner:

- **session_runs**: Tracks run state, prompts, metrics, break state
- **session_attempts**: Individual prompt answers with self-scores
- **session_error_logs**: Error categorization and correction rules

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

## CI Pipeline

GitHub Actions workflow at `.github/workflows/quality-gate.yml`:

1. **Lint & Typecheck** — `tsc --noEmit`
2. **Unit Tests** — fast, no DB
3. **Integration Tests** — with PostgreSQL service container
4. **E2E Tests** — Playwright headless against built app + PostgreSQL
