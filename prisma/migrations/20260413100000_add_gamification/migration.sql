-- Add SM-2 spaced repetition fields to flashcards
ALTER TABLE "flashcards" ADD COLUMN "ease_factor" DOUBLE PRECISION NOT NULL DEFAULT 2.5;
ALTER TABLE "flashcards" ADD COLUMN "interval_days" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "flashcards" ADD COLUMN "repetitions" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "flashcards" ADD COLUMN "next_due_at" TIMESTAMPTZ;

CREATE INDEX "flashcards_deck_due_idx" ON "flashcards"("deck_id", "next_due_at");

-- Card review history
CREATE TABLE "card_reviews" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "ease_factor" DOUBLE PRECISION NOT NULL,
    "interval_days" INTEGER NOT NULL,
    "repetitions" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_reviews_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "card_reviews_card_id_idx" ON "card_reviews"("card_id");
CREATE INDEX "card_reviews_user_id_created_at_idx" ON "card_reviews"("user_id", "created_at");

ALTER TABLE "card_reviews" ADD CONSTRAINT "card_reviews_card_id_fkey"
    FOREIGN KEY ("card_id") REFERENCES "flashcards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- XP events
CREATE TABLE "xp_events" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "xp_amount" INTEGER NOT NULL,
    "source_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "xp_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "xp_events_user_id_created_at_idx" ON "xp_events"("user_id", "created_at");

-- Achievements / badges
CREATE TABLE "achievements" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "badge_type" TEXT NOT NULL,
    "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "achievements_user_badge_key" ON "achievements"("user_id", "badge_type");
CREATE INDEX "achievements_user_id_idx" ON "achievements"("user_id");

-- User game state (streak freezes, daily goal)
CREATE TABLE "user_game_state" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "daily_xp_goal" INTEGER NOT NULL DEFAULT 50,
    "streak_freezes" INTEGER NOT NULL DEFAULT 0,
    "streak_freeze_used_date" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_game_state_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_game_state_user_id_key" ON "user_game_state"("user_id");
