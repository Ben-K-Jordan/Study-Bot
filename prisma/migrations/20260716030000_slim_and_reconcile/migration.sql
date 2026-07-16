-- Slim & reconcile: drop dead feature tables (push notifications, scheduled
-- reminders, practice sets) and fix schema/migration drift so
-- `prisma migrate diff --from-migrations --to-schema` is clean.

-- ---------------------------------------------------------------------------
-- 1. Drop dead feature tables (feature code already removed)
-- ---------------------------------------------------------------------------

-- DropForeignKey
ALTER TABLE "practice_questions" DROP CONSTRAINT "practice_questions_practice_set_id_fkey";

-- DropForeignKey
ALTER TABLE "push_subscriptions" DROP CONSTRAINT "push_subscriptions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "scheduled_reminders" DROP CONSTRAINT "scheduled_reminders_user_id_fkey";

-- DropTable
DROP TABLE "practice_questions";

-- DropTable
DROP TABLE "practice_sets";

-- DropTable
DROP TABLE "push_subscriptions";

-- DropTable
DROP TABLE "scheduled_reminders";

-- ---------------------------------------------------------------------------
-- 2. Drift: session_error_logs.user_id carried a stray DEFAULT ''
-- ---------------------------------------------------------------------------

-- AlterTable
ALTER TABLE "session_error_logs" ALTER COLUMN "user_id" DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 3. Drift: foreign keys created with ON DELETE RESTRICT, schema declares
--    onDelete: Cascade
-- ---------------------------------------------------------------------------

-- DropForeignKey
ALTER TABLE "session_runs" DROP CONSTRAINT "session_runs_session_id_fkey";

-- DropForeignKey
ALTER TABLE "session_attempts" DROP CONSTRAINT "session_attempts_run_id_fkey";

-- DropForeignKey
ALTER TABLE "session_error_logs" DROP CONSTRAINT "session_error_logs_run_id_fkey";

-- DropForeignKey
ALTER TABLE "study_plan_items" DROP CONSTRAINT "study_plan_items_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_calendar_publications" DROP CONSTRAINT "plan_calendar_publications_plan_id_fkey";

-- DropForeignKey
ALTER TABLE "plan_item_external_events" DROP CONSTRAINT "plan_item_external_events_plan_item_id_fkey";

-- AddForeignKey
ALTER TABLE "session_runs" ADD CONSTRAINT "session_runs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_attempts" ADD CONSTRAINT "session_attempts_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "session_runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_error_logs" ADD CONSTRAINT "session_error_logs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "session_runs"("run_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_plan_items" ADD CONSTRAINT "study_plan_items_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "study_plans"("plan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_calendar_publications" ADD CONSTRAINT "plan_calendar_publications_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "study_plans"("plan_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_item_external_events" ADD CONSTRAINT "plan_item_external_events_plan_item_id_fkey" FOREIGN KEY ("plan_item_id") REFERENCES "study_plan_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 4. Drift: indexes declared in the schema but never migrated
-- ---------------------------------------------------------------------------

-- CreateIndex
CREATE INDEX "evidence_cards_strength_idx" ON "evidence_cards"("strength");

-- CreateIndex
CREATE INDEX "session_runs_user_created_idx" ON "session_runs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "sessions_user_created_idx" ON "sessions"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "study_plans_user_exam_date_idx" ON "study_plans"("user_id", "exam_date");

-- Dedupe flashcard ordinals before adding the unique index: reassign a dense
-- 0-based ordinal per deck, preserving existing order (ordinal, then insert
-- order) so decks with duplicate or gappy ordinals migrate cleanly.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "deck_id"
      ORDER BY "ordinal", "created_at", "id"
    ) - 1 AS new_ordinal
  FROM "flashcards"
)
UPDATE "flashcards" f
SET "ordinal" = ranked.new_ordinal
FROM ranked
WHERE f."id" = ranked."id"
  AND f."ordinal" IS DISTINCT FROM ranked.new_ordinal;

-- CreateIndex
CREATE UNIQUE INDEX "flashcards_deck_ordinal_key" ON "flashcards"("deck_id", "ordinal");
