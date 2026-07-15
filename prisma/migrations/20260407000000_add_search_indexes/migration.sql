-- GIN index for full-text search on content_chunks.text
-- Dramatically speeds up tsvector @@ tsquery lookups
CREATE INDEX IF NOT EXISTS idx_content_chunks_text_fts
  ON content_chunks USING gin (to_tsvector('english', text));

-- Note: HNSW index for pgvector embedding column is deferred until
-- the embedding column is added via a future migration (pgvector setup).
