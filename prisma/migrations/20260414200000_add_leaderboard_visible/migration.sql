-- Add leaderboard visibility toggle to user game state
ALTER TABLE "user_game_state" ADD COLUMN "leaderboard_visible" BOOLEAN NOT NULL DEFAULT true;
