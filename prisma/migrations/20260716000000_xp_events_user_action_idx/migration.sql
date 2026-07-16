-- CreateIndex
-- Badge/freeze marker lookups filter on (user_id, action); the existing
-- (user_id, created_at) index cannot serve them without a filter scan.
CREATE INDEX "xp_events_user_id_action_idx" ON "xp_events"("user_id", "action");
