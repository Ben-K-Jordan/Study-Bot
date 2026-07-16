-- Per-user IANA timezone for streak day boundaries (NULL = UTC, preserving prior behavior)
ALTER TABLE "user_game_state" ADD COLUMN "timezone" TEXT;
