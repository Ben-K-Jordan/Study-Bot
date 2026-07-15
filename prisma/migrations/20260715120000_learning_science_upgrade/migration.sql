-- Learning-science upgrade
-- Hypercorrection + successive relearning on error logs
ALTER TABLE "session_error_logs" ADD COLUMN "confidence_rating" INTEGER;
ALTER TABLE "session_error_logs" ADD COLUMN "correct_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "session_error_logs" ADD COLUMN "last_correct_at" TIMESTAMPTZ;

-- Persisted AI feedback + Socratic answer on attempts
ALTER TABLE "session_attempts" ADD COLUMN "socratic_answer" TEXT;
ALTER TABLE "session_attempts" ADD COLUMN "feedback_status" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "session_attempts" ADD COLUMN "feedback_json" JSONB;

-- One Error Repair deck per (user, course, title) — closes the concurrent
-- completion race that created duplicate decks.
-- Deduplicate any existing duplicates first (keep the oldest deck, move cards).
WITH ranked AS (
  SELECT id, user_id, course_name, title,
         ROW_NUMBER() OVER (PARTITION BY user_id, course_name, title ORDER BY created_at ASC) AS rn,
         FIRST_VALUE(id) OVER (PARTITION BY user_id, course_name, title ORDER BY created_at ASC) AS keeper_id
  FROM "flashcard_decks"
)
UPDATE "flashcards" f
SET "deck_id" = r.keeper_id,
    "ordinal" = f."ordinal" + (100000 * r.rn)
FROM ranked r
WHERE f."deck_id" = r.id AND r.rn > 1;

DELETE FROM "flashcard_decks" d
USING (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id, course_name, title ORDER BY created_at ASC) AS rn
  FROM "flashcard_decks"
) r
WHERE d.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX "flashcard_decks_user_course_title_key" ON "flashcard_decks"("user_id", "course_name", "title");
