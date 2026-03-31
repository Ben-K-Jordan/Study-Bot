-- Phase 4: Performance indexes (run via prisma db execute or manually)
-- These cannot be expressed in Prisma schema.

-- FTS GIN expression index on content_chunks.text
CREATE INDEX CONCURRENTLY IF NOT EXISTS content_chunks_text_fts_idx
  ON content_chunks USING GIN (to_tsvector('english', text));

-- Partial index for active runs (hot-path lookup)
CREATE INDEX CONCURRENTLY IF NOT EXISTS session_runs_active_idx
  ON session_runs (user_id, status) WHERE status = 'ACTIVE';

-- Partial index for unresolved error logs
CREATE INDEX CONCURRENTLY IF NOT EXISTS session_error_logs_unresolved_idx
  ON session_error_logs (user_id, created_at DESC) WHERE resolved_at IS NULL;
