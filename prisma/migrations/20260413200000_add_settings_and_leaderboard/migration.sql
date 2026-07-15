-- Add user settings and display name to game state
ALTER TABLE "user_game_state" ADD COLUMN "display_name" TEXT;
ALTER TABLE "user_game_state" ADD COLUMN "study_start_time" TEXT NOT NULL DEFAULT '09:00';
ALTER TABLE "user_game_state" ADD COLUMN "study_end_time" TEXT NOT NULL DEFAULT '17:00';
ALTER TABLE "user_game_state" ADD COLUMN "daily_study_cap" INTEGER NOT NULL DEFAULT 180;
