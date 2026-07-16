-- Drop the unused notification preferences table (feature was never shipped)
DROP TABLE "notification_preferences";

-- Drop dead columns from user_game_state
ALTER TABLE "user_game_state" DROP COLUMN "display_name";
ALTER TABLE "user_game_state" DROP COLUMN "leaderboard_visible";
