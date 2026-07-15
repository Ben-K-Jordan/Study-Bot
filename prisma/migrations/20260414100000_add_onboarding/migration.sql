-- Add onboarding tracking
ALTER TABLE "user_game_state" ADD COLUMN "onboarding_complete" BOOLEAN NOT NULL DEFAULT false;
