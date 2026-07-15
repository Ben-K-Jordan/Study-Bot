-- Add metacognitive fields to session_attempts for confidence calibration,
-- self-explanation, and generation effect tracking.

ALTER TABLE session_attempts ADD COLUMN IF NOT EXISTS confidence_rating INTEGER;
ALTER TABLE session_attempts ADD COLUMN IF NOT EXISTS self_explanation TEXT;
ALTER TABLE session_attempts ADD COLUMN IF NOT EXISTS generated_example TEXT;
